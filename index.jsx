import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, query, updateDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { Home, PlusCircle, User, Heart, ChevronLeft, Bot, Settings, LogOut, Loader2, Info } from 'lucide-react';

// --- Firebase Initialization ---
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-kingen-app';

// --- API Helpers ---
const checkWordWithAI = async (content, author, customApiKey) => {
  const apiKey = customApiKey || ""; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  
  const prompt = `以下の言葉が、指定された発言者（偉人、哲学者、有名人、アニメキャラ等）によって実際に言われたものか、またはその発言者の思想・キャラクター性に合致して意味が通っているかを判定してください。
言葉: "${content}"
発言者: "${author}"

以下のJSONフォーマットで回答してください。
{
  "isValid": true または false (実在する、あるいはキャラクターに合っている場合はtrue),
  "explanation": "この言葉の背景や解説。なぜこの人が言ったとされるのか、どのような意味を持つのかなど。",
  "translated": "この言葉の英語等の意訳（該当がない場合や英語の言葉の場合は空文字）"
}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          isValid: { type: "BOOLEAN" },
          explanation: { type: "STRING" },
          translated: { type: "STRING" }
        }
      }
    }
  };

  const fetchWithRetry = async (retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('API Error');
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No text in response');
        return JSON.parse(text);
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
      }
    }
  };

  return fetchWithRetry();
};

// --- Components ---

// UI: Avatar for Authors
const AuthorAvatar = ({ name, size = 'md' }) => {
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  const sizeClasses = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-14 h-14 text-xl'
  };
  return (
    <div className={`${sizeClasses[size]} rounded-full bg-gray-800 text-white flex items-center justify-center font-bold flex-shrink-0`}>
      {initial}
    </div>
  );
};

// UI: Time formatter
const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
};

// --- Main App Component ---
export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  
  const [currentTab, setCurrentTab] = useState('home'); // home, add, profile
  const [activePost, setActivePost] = useState(null); // For detail view
  
  const [isInitializing, setIsInitializing] = useState(true);

  // 1. Auth Initialization
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth init failed:", error);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      if (!user) setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Fetch User Profile
  useEffect(() => {
    if (!authUser) return;
    const profileRef = doc(db, 'artifacts', appId, 'users', authUser.uid, 'profile', 'data');
    const unsub = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        setUserProfile(docSnap.data());
      } else {
        setUserProfile(null);
      }
      setIsInitializing(false);
    }, (err) => {
      console.error("Profile fetch error:", err);
      setIsInitializing(false);
    });
    return () => unsub();
  }, [authUser]);

  // 3. Fetch Posts (All posts)
  useEffect(() => {
    if (!authUser) return;
    const postsRef = collection(db, 'artifacts', appId, 'public', 'data', 'posts');
    const unsub = onSnapshot(postsRef, (snap) => {
      const postsData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort by newest by default in memory
      postsData.sort((a, b) => b.createdAt - a.createdAt);
      setPosts(postsData);
    }, (err) => console.error("Posts fetch error:", err));
    return () => unsub();
  }, [authUser]);


  // Actions
  const toggleLike = async (postId, currentLikes, likedBy) => {
    if (!authUser || !userProfile) return;
    const isLiked = likedBy.includes(authUser.uid);
    const postRef = doc(db, 'artifacts', appId, 'public', 'data', 'posts', postId);
    
    let newLikedBy = [...likedBy];
    if (isLiked) {
      newLikedBy = newLikedBy.filter(id => id !== authUser.uid);
    } else {
      newLikedBy.push(authUser.uid);
    }
    
    await updateDoc(postRef, {
      likes: newLikedBy.length,
      likedBy: newLikedBy
    });
  };

  const toggleFollowAuthor = async (authorName) => {
    if (!authUser || !userProfile) return;
    const profileRef = doc(db, 'artifacts', appId, 'users', authUser.uid, 'profile', 'data');
    
    let newFollowing = [...(userProfile.followedAuthors || [])];
    if (newFollowing.includes(authorName)) {
      newFollowing = newFollowing.filter(name => name !== authorName);
    } else {
      newFollowing.push(authorName);
    }
    
    await updateDoc(profileRef, { followedAuthors: newFollowing });
  };

  const updateProfile = async (updates) => {
    if (!authUser) return;
    const profileRef = doc(db, 'artifacts', appId, 'users', authUser.uid, 'profile', 'data');
    await updateDoc(profileRef, updates);
  };


  if (isInitializing) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  // Screens Rendering
  const fontClass = userProfile?.fontPreference === 'serif' ? 'font-serif' : 'font-sans';

  return (
    <div className={`max-w-md mx-auto h-screen bg-gray-50 flex flex-col relative shadow-2xl overflow-hidden ${fontClass} text-gray-900`}>
      
      {/* If no profile exists, show Login/Registration */}
      {!userProfile ? (
        <LoginScreen authUser={authUser} />
      ) : (
        <>
          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto pb-16 relative">
            {activePost ? (
              <PostDetailScreen 
                post={activePost} 
                onBack={() => setActivePost(null)}
                userProfile={userProfile}
                onLike={() => toggleLike(activePost.id, activePost.likes, activePost.likedBy || [])}
                isLiked={(activePost.likedBy || []).includes(authUser.uid)}
                onFollow={() => toggleFollowAuthor(activePost.author)}
                isFollowing={(userProfile.followedAuthors || []).includes(activePost.author)}
              />
            ) : (
              <>
                {currentTab === 'home' && (
                  <HomeScreen 
                    posts={posts} 
                    userProfile={userProfile} 
                    onPostClick={setActivePost}
                    onLike={(p) => toggleLike(p.id, p.likes, p.likedBy || [])}
                    currentUserId={authUser.uid}
                  />
                )}
                {currentTab === 'add' && (
                  <CreatePostScreen 
                    onSuccess={() => setCurrentTab('home')}
                    userProfile={userProfile}
                    currentUserId={authUser.uid}
                  />
                )}
                {currentTab === 'profile' && (
                  <ProfileScreen 
                    userProfile={userProfile} 
                    posts={posts.filter(p => p.postedByUid === authUser.uid)}
                    onPostClick={setActivePost}
                    onUpdateProfile={updateProfile}
                  />
                )}
              </>
            )}
          </div>

          {/* Bottom Navigation */}
          {!activePost && (
            <div className="absolute bottom-0 w-full bg-white border-t border-gray-200 flex justify-around items-center h-16 px-4 z-50">
              <button onClick={() => setCurrentTab('home')} className={`p-2 flex flex-col items-center ${currentTab === 'home' ? 'text-black' : 'text-gray-400'}`}>
                <Home className="w-6 h-6" />
                <span className="text-[10px] mt-1">ホーム</span>
              </button>
              <button onClick={() => setCurrentTab('add')} className={`p-2 flex flex-col items-center ${currentTab === 'add' ? 'text-black' : 'text-gray-400'}`}>
                <PlusCircle className="w-8 h-8" />
              </button>
              <button onClick={() => setCurrentTab('profile')} className={`p-2 flex flex-col items-center ${currentTab === 'profile' ? 'text-black' : 'text-gray-400'}`}>
                <User className="w-6 h-6" />
                <span className="text-[10px] mt-1">マイページ</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ==========================================
// Sub Screens
// ==========================================

// --- Login / Register Screen ---
function LoginScreen({ authUser }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !authUser) return;
    setLoading(true);
    try {
      // In this environment, we simulate registration/login by creating a profile
      // with a unique user number if it's registration.
      const profileRef = doc(db, 'artifacts', appId, 'users', authUser.uid, 'profile', 'data');
      const docSnap = await getDoc(profileRef);
      
      if (!docSnap.exists()) {
        // Create new profile
        await setDoc(profileRef, {
          username: username.trim(),
          userNumber: Math.floor(1000 + Math.random() * 9000), // e.g. 2579
          followedAuthors: [],
          fontPreference: 'sans',
          geminiApiKey: ''
        });
      }
      // If it exists, it will automatically transition due to the snapshot listener in App
    } catch (error) {
      console.error(error);
      alert("エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 bg-white">
      <h1 className="text-3xl font-serif font-bold tracking-widest mb-2">KINGEN</h1>
      <p className="text-gray-500 text-sm mb-10 text-center">質の高い言葉だけが存在するSNS</p>
      
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ID (ユーザー名)</label>
          <input 
            type="text" 
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-800 outline-none transition"
            placeholder="お好きな名前"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-800 outline-none transition"
            placeholder="パスワード"
            required
          />
        </div>
        <button 
          type="submit" 
          disabled={loading}
          className="w-full bg-black text-white py-3 rounded-lg font-medium hover:bg-gray-800 transition flex justify-center items-center mt-6"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isLoginMode ? 'ログイン' : '新規登録してはじめる')}
        </button>
      </form>
      
      <button 
        onClick={() => setIsLoginMode(!isLoginMode)}
        className="mt-6 text-sm text-gray-500 hover:text-black underline"
      >
        {isLoginMode ? 'アカウントをお持ちでない方はこちら' : 'すでにアカウントをお持ちの方はこちら'}
      </button>
    </div>
  );
}

// --- Home Screen ---
function HomeScreen({ posts, userProfile, onPostClick, onLike, currentUserId }) {
  const [subTab, setSubTab] = useState('recommend'); // recommend, following

  const displayPosts = useMemo(() => {
    if (subTab === 'recommend') {
      // Recommend: Sort by likes, then by date
      return [...posts].sort((a, b) => {
        if (b.likes !== a.likes) return b.likes - a.likes;
        return b.createdAt - a.createdAt;
      });
    } else {
      // Following
      const followed = userProfile?.followedAuthors || [];
      return posts.filter(p => followed.includes(p.author)).sort((a, b) => b.createdAt - a.createdAt);
    }
  }, [posts, subTab, userProfile]);

  return (
    <div className="flex flex-col min-h-full bg-white">
      {/* Header Tabs */}
      <div className="sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-gray-100 flex px-4 pt-4 pb-2">
        <button 
          onClick={() => setSubTab('recommend')}
          className={`flex-1 text-center pb-2 font-medium transition-colors border-b-2 ${subTab === 'recommend' ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          おすすめ
        </button>
        <button 
          onClick={() => setSubTab('following')}
          className={`flex-1 text-center pb-2 font-medium transition-colors border-b-2 ${subTab === 'following' ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          フォロー
        </button>
      </div>

      {/* Post List */}
      <div className="flex-1 p-0">
        {displayPosts.length === 0 ? (
          <div className="p-8 text-center text-gray-400 mt-10">
            {subTab === 'recommend' ? '投稿がありません。' : 'フォローしている発言者の投稿がありません。'}
          </div>
        ) : (
          displayPosts.map(post => (
            <div key={post.id} className="border-b border-gray-100 p-4 hover:bg-gray-50 transition cursor-pointer" onClick={() => onPostClick(post)}>
              <div className="flex items-start gap-3">
                <AuthorAvatar name={post.author} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between mb-1">
                    <h3 className="font-bold text-gray-900 truncate">{post.author}</h3>
                    <span className="text-xs text-gray-400 whitespace-nowrap ml-2">{formatTime(post.createdAt)}</span>
                  </div>
                  <p className="text-gray-800 whitespace-pre-wrap leading-relaxed text-[15px]">{post.content}</p>
                  
                  {/* Action Bar */}
                  <div className="flex items-center justify-end mt-3 gap-4">
                    <button 
                      onClick={(e) => { e.stopPropagation(); onLike(post); }}
                      className="flex items-center gap-1.5 group"
                    >
                      <Heart className={`w-5 h-5 transition-colors ${(post.likedBy || []).includes(currentUserId) ? 'fill-red-500 text-red-500' : 'text-gray-400 group-hover:text-red-400'}`} />
                      <span className={`text-sm ${(post.likedBy || []).includes(currentUserId) ? 'text-red-500' : 'text-gray-500'}`}>{post.likes || 0}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- Post Detail Screen ---
function PostDetailScreen({ post, onBack, userProfile, onLike, isLiked, onFollow, isFollowing }) {
  if (!post) return null;

  return (
    <div className="flex flex-col h-full bg-white animate-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-gray-100 px-2 py-3 flex items-center">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <span className="font-bold ml-2">ホーム</span>
      </div>

      <div className="p-5 flex-1 overflow-y-auto">
        {/* Author Info */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <AuthorAvatar name={post.author} size="lg" />
            <div>
              <h2 className="font-bold text-xl">{post.author}</h2>
            </div>
          </div>
          <button 
            onClick={onFollow}
            className={`px-4 py-1.5 rounded-full text-sm font-bold border transition ${isFollowing ? 'bg-white text-black border-gray-300' : 'bg-black text-white border-black'}`}
          >
            {isFollowing ? 'フォロー中' : 'フォロー'}
          </button>
        </div>

        {/* Content */}
        <div className="mb-8">
          <p className="text-2xl leading-loose font-medium text-gray-900 whitespace-pre-wrap">{post.content}</p>
          {post.translated && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-xs font-bold text-gray-500 mb-1 block">意訳・原文</span>
              <p className="text-sm text-gray-600">{post.translated}</p>
            </div>
          )}
        </div>

        {/* AI Explanation Area */}
        <div className="bg-gray-50 rounded-xl p-4 mb-8 border border-gray-100 relative">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-5 h-5 text-indigo-500" />
            <span className="text-sm font-bold text-indigo-900">AI 解説</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {post.aiExplanation}
          </p>
        </div>

        {/* Metadata Footer */}
        <div className="flex items-end justify-between mt-auto pt-6 border-t border-gray-100">
          <div className="flex flex-col gap-1">
            <span className="text-gray-400 text-sm">{formatTime(post.createdAt)}</span>
            <button 
              onClick={onLike}
              className="flex items-center gap-1.5 mt-2"
            >
               <Heart className={`w-6 h-6 transition-colors ${isLiked ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
               <span className={`font-medium ${isLiked ? 'text-red-500' : 'text-gray-500'}`}>{post.likes || 0}</span>
            </button>
          </div>
          
          {/* Poster Mark (No modern user profiles, just a subtle mark) */}
          <div className="flex items-center gap-1 text-gray-400 bg-gray-50 px-3 py-1.5 rounded-md border border-gray-100">
            <span className="text-xs font-medium">{post.postedByUserNumber}号</span>
            <span className="text-[10px]">投稿者マーク</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Create Post Screen ---
function CreatePostScreen({ onSuccess, userProfile, currentUserId }) {
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handlePost = async () => {
    if (!content.trim() || !author.trim()) {
      setErrorMsg('言葉と発言者を入力してください。');
      return;
    }

    setIsChecking(true);
    setErrorMsg('');

    try {
      // AI Check
      const result = await checkWordWithAI(content, author, userProfile?.geminiApiKey);
      
      if (result.isValid) {
        // Save to Firestore
        const postData = {
          content: content.trim(),
          author: author.trim(),
          aiExplanation: result.explanation,
          translated: result.translated || "",
          postedByUid: currentUserId,
          postedByUserNumber: userProfile.userNumber,
          createdAt: Date.now(),
          likes: 0,
          likedBy: []
        };
        
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'posts'), postData);
        onSuccess();
      } else {
        setErrorMsg('AI判定: その発言者による言葉として確認できませんでした。正しいか見直してください。\n理由: ' + result.explanation);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('検証に失敗しました。時間をおいて再試行するか、APIキーの設定を確認してください。');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="p-4 h-full flex flex-col bg-white">
      <div className="flex items-center justify-between mb-6 pt-2">
        <h2 className="text-xl font-bold">名言を共有する</h2>
      </div>

      <div className="flex-1 flex flex-col gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">言葉</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-32 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-black outline-none resize-none text-lg"
            placeholder="好きな名言や金言を入力してください"
            disabled={isChecking}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">発言者</label>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-black outline-none text-lg"
            placeholder="ソクラテス、ゲーテ、アニメキャラ名など"
            disabled={isChecking}
          />
        </div>

        {errorMsg && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="whitespace-pre-wrap">{errorMsg}</span>
          </div>
        )}

        <div className="mt-auto mb-4">
          <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-xs mb-4 flex items-start gap-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>投稿する前にAIが言葉の実在性や妥当性をチェックします。現代の人の言葉（自身のコメント等）は投稿できません。</p>
          </div>
          <button
            onClick={handlePost}
            disabled={isChecking}
            className={`w-full py-4 rounded-xl font-bold text-white flex items-center justify-center transition-colors shadow-sm ${isChecking ? 'bg-gray-400' : 'bg-black hover:bg-gray-800'}`}
          >
            {isChecking ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                AIが確認中...
              </>
            ) : (
              'AIでチェックして投稿する'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Profile Screen ---
function ProfileScreen({ userProfile, posts, onPostClick, onUpdateProfile }) {
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(userProfile?.geminiApiKey || '');

  const toggleFont = () => {
    onUpdateProfile({ fontPreference: userProfile.fontPreference === 'sans' ? 'serif' : 'sans' });
  };

  const saveSettings = () => {
    onUpdateProfile({ geminiApiKey: apiKeyInput });
    setIsEditingSettings(false);
  };

  return (
    <div className="flex flex-col min-h-full bg-white">
      {/* Profile Header */}
      <div className="p-6 border-b border-gray-100 bg-gray-50 flex flex-col items-center">
        <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center mb-3">
          <User className="w-10 h-10 text-gray-500" />
        </div>
        <h2 className="text-xl font-bold">{userProfile?.username}</h2>
        <span className="text-sm text-gray-500 mt-1">会員番号: {userProfile?.userNumber}号</span>
        <p className="text-xs text-gray-400 mt-2 text-center max-w-xs">
          現代の人のプロフィールはこれだけです。質の高い昔の言葉に集中しましょう。
        </p>
        
        <div className="flex gap-2 mt-4">
          <button 
            onClick={toggleFont}
            className="px-4 py-2 bg-white border border-gray-200 rounded-full text-sm font-medium shadow-sm hover:bg-gray-50 transition"
          >
            {userProfile?.fontPreference === 'serif' ? '明朝体を使用中' : 'ゴシック体を使用中'}
          </button>
          <button 
            onClick={() => setIsEditingSettings(!isEditingSettings)}
            className="p-2 bg-white border border-gray-200 rounded-full text-sm shadow-sm hover:bg-gray-50 transition"
          >
            <Settings className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {isEditingSettings && (
        <div className="p-4 border-b border-gray-100 bg-gray-100">
          <h3 className="font-bold text-sm mb-2">Gemini APIキー設定 (任意)</h3>
          <p className="text-xs text-gray-500 mb-2">自身の環境で動かす場合に入力してください。設定しない場合はデフォルト環境が使用されます。</p>
          <div className="flex gap-2">
            <input 
              type="password" 
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="flex-1 p-2 text-sm rounded border border-gray-300 outline-none"
              placeholder="AIzaSy..."
            />
            <button onClick={saveSettings} className="bg-black text-white px-3 py-2 rounded text-sm font-bold">
              保存
            </button>
          </div>
        </div>
      )}

      {/* My Posts */}
      <div className="flex-1">
        <div className="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-md z-10">
          <h3 className="font-bold text-gray-800">自分の投稿一覧</h3>
        </div>
        
        {posts.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            まだ投稿がありません。
          </div>
        ) : (
          posts.sort((a, b) => b.createdAt - a.createdAt).map(post => (
            <div key={post.id} className="border-b border-gray-100 p-4 hover:bg-gray-50 transition cursor-pointer" onClick={() => onPostClick(post)}>
              <div className="flex items-start gap-3">
                <AuthorAvatar name={post.author} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <h4 className="font-bold text-sm">{post.author}</h4>
                    <span className="text-xs text-gray-400">{formatTime(post.createdAt)}</span>
                  </div>
                  <p className="text-gray-800 text-sm truncate">{post.content}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <Heart className="w-3 h-3 text-red-500 fill-red-500" />
                    <span className="text-xs text-gray-500">{post.likes || 0}</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
