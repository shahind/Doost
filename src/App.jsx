import React, { useState, useEffect, useMemo } from 'react';
import { 
  Home, Search, Shuffle, Heart, Share2, ChevronRight, ChevronLeft, 
  BookOpen, Info, Loader2, Copy, Check, Filter, Star, Hash
} from 'lucide-react';

// --- STYLES & FONTS ---
const fontStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Estedad:wght@300;400;600;800&display=swap');
  
  :root {
    --color-red: #A00A0F;
    --color-green: #35646A;
    --color-cream: #FAF4ED;
    --color-brown: #373232;
  }
  
  body, html {
    background-color: var(--color-cream);
    color: var(--color-brown);
    font-family: 'Estedad', sans-serif;
    direction: rtl;
    margin: 0;
    padding: 0;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior-y: none;
  }

  .font-poem {
    font-family: 'Amiri', serif;
    line-height: 2.2;
  }

  .persian-pattern {
    background-color: var(--color-cream);
    background-image: 
      radial-gradient(var(--color-green) 1px, transparent 1px),
      radial-gradient(var(--color-green) 1px, transparent 1px);
    background-size: 24px 24px;
    background-position: 0 0, 12px 12px;
    opacity: 0.06;
  }
  
  ::-webkit-scrollbar { width: 0px; background: transparent; }
  .hide-scrollbar::-webkit-scrollbar { display: none; }
  .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  
  .pb-safe { padding-bottom: env(safe-area-inset-bottom, 16px); }
  .pt-safe { padding-top: env(safe-area-inset-top, 0px); }

  .versesbox{
    background-image: url("bg.png");
    background-repeat: repeat;
  }
`;

// --- MOCK DATA FALLBACK ---
const MOCK_DB = {
  poets: [
    { id: 1, name: 'حافظ', cat_id: 1 },
    { id: 2, name: 'سعدی', cat_id: 2 },
    { id: 3, name: 'فردوسی', cat_id: 3 },
    { id: 4, name: 'مولوی', cat_id: 4 }
  ],
  cats: [
    { id: 1, poet_id: 1, text: 'دیوان حافظ', parent_id: 0 },
    { id: 11, poet_id: 1, text: 'غزلیات', parent_id: 1 },
    { id: 2, poet_id: 2, text: 'گلستان', parent_id: 0 },
    { id: 21, poet_id: 2, text: 'باب اول در سیرت پادشاهان', parent_id: 2 },
    { id: 4, poet_id: 4, text: 'مثنوی معنوی', parent_id: 0 }
  ],
  poems: [
    { id: 1, cat_id: 11, title: 'غزل شماره ۱', url: '' },
    { id: 2, cat_id: 11, title: 'غزل شماره ۲', url: '' },
    { id: 3, cat_id: 21, title: 'حکایت شماره ۱', url: '' }
  ],
  verses: [
    { poem_id: 1, vorder: 1, position: 0, text: 'الا یا ایها الساقی ادر کاسا و ناولها' },
    { poem_id: 1, vorder: 2, position: 1, text: 'که عشق آسان نمود اول ولی افتاد مشکل‌ها' },
    { poem_id: 1, vorder: 3, position: 0, text: 'به بوی نافه‌ای کاخر صبا زان طره بگشاید' },
    { poem_id: 1, vorder: 4, position: 1, text: 'ز تاب جعد مشکینش چه خون افتاد در دل‌ها' },
    { poem_id: 3, vorder: 1, position: -1, text: 'پادشاهی را شنیدم که به کشتن اسیری اشارت کرد. بیچاره در آن حالت نومیدی ملک را دشنام دادن گرفت...' },
    { poem_id: 3, vorder: 2, position: 4, text: 'هر که دست از جان بشوید، هر چه در دل دارد بگوید.' },
    { poem_id: 3, vorder: 3, position: 0, text: 'وقت ضرورت چو نماند گریز' },
    { poem_id: 3, vorder: 4, position: 1, text: 'دست بگیرد سر شمشیر تیز' }
  ]
};

// --- MAIN APPLICATION COMPONENT ---
export default function DoostApp() {
  const [appLoading, setAppLoading] = useState(true);
  const [db, setDb] = useState(null);
  const [useMockData, setUseMockData] = useState(false);
  const [sqlJsReady, setSqlJsReady] = useState(false);
  
  const [viewStack, setViewStack] = useState([{ name: 'home', params: {} }]);
  const [favorites, setFavorites] = useState(() => JSON.parse(localStorage.getItem('doost_favorites') || '[]'));
  
  // New state for organizing favorites by poet
  const [favSelectedPoetId, setFavSelectedPoetId] = useState(null);

  // Global share state to escape stacking contexts
  const [shareData, setShareData] = useState(null);

  // Global search state to persist results & filters across navigation
  const [searchState, setSearchState] = useState({
    term: '',
    results: [],
    hasSearched: false,
    showFilters: false,
    selectedPoet: 'all',
    selectedBook: 'all',
    selectedSection: 'all'
  });

  // Selected Poets State
  const [selectedPoetNames, setSelectedPoetNames] = useState(() => {
    const saved = localStorage.getItem('doost_selected_poets');
    return saved ? JSON.parse(saved) : ['حافظ', 'سعدی', 'فردوسی', 'نظامی', 'مولانا', 'مولوی', 'خیام', 'رودکی', 'عطار'];
  });
  
  const currentView = viewStack[viewStack.length - 1];

  // 1. Inject Styles & Load SQL.js
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.innerHTML = fontStyles;
    document.head.appendChild(styleEl);

    if (!window.initSqlJs) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js';
      script.onload = () => setSqlJsReady(true);
      document.head.appendChild(script);
    } else {
      setSqlJsReady(true);
    }
    
    return () => { document.head.removeChild(styleEl); };
  }, []);

  // 2. Automatically load Local Database or Fallback
  useEffect(() => {
    if (!sqlJsReady) return;

    const initDb = async () => {
      try {
        const SQL = await window.initSqlJs({
          locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        
        const response = await fetch(import.meta.env.VITE_DB_URL);
        if (!response.ok) throw new Error("Local DB not found");
        
        const buf = await response.arrayBuffer();
        const database = new SQL.Database(new Uint8Array(buf));
        setDb(database);
        setUseMockData(false);
      } catch (err) {
        console.warn("Could not fetch database Falling back to Mock Data for preview.", err);
        setUseMockData(true);
      } finally {
        setAppLoading(false);
      }
    };

    initDb();
  }, [sqlJsReady]);

  // Sync LocalStorage
  useEffect(() => {
    localStorage.setItem('doost_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('doost_selected_poets', JSON.stringify(selectedPoetNames));
  }, [selectedPoetNames]);

  // Scroll to top of individual views on navigation
  useEffect(() => {
    const scrollable = document.querySelector('.view-scroll-container');
    if (scrollable) scrollable.scrollTop = 0;
  }, [viewStack, favSelectedPoetId]);

  // --- QUERY ABSTRACTION ---
  const queryData = (queryName, params = {}) => {
    if (useMockData) {
      // Mock Data Implementations
      const getMockDescendants = (rootId) => {
        let ids = [rootId];
        let added = true;
        while(added) {
          added = false;
          MOCK_DB.cats.forEach(c => {
            if (ids.includes(c.parent_id) && !ids.includes(c.id)) { ids.push(c.id); added = true; }
          });
        }
        return ids;
      };

      switch(queryName) {
        case 'getPoets': return MOCK_DB.poets;
        case 'getCatsByParent': 
          if(params.poet_id) {
             const roots = MOCK_DB.cats.filter(c => c.poet_id === params.poet_id && c.parent_id === 0);
             return MOCK_DB.cats.filter(c => roots.some(r => r.id === c.parent_id));
          }
          return MOCK_DB.cats.filter(c => c.parent_id === params.parent_id);
        case 'getCat': return MOCK_DB.cats.find(c => c.id === params.id) || null;
        case 'getPoet': return MOCK_DB.poets.find(p => p.id === params.id) || null;
        case 'getPoemsByCat': return MOCK_DB.poems.filter(p => p.cat_id === params.cat_id);
        case 'getPoem': return MOCK_DB.poems.find(p => p.id === params.id) || null;
        case 'getVerses': return MOCK_DB.verses.filter(v => v.poem_id === params.poem_id).sort((a,b)=>a.vorder - b.vorder);
        case 'search': 
          let filteredVerses = MOCK_DB.verses.filter(v => v.text.includes(params.term));
          return filteredVerses.map(v => {
            const p = MOCK_DB.poems.find(p => p.id === v.poem_id);
            const c = MOCK_DB.cats.find(c => c.id === p.cat_id);
            const pt = MOCK_DB.poets.find(pt => pt.id === c.poet_id);
            return { ...v, poem_title: p.title, cat_name: c.text, poet_name: pt.name, poet_id: pt.id, cat_id: c.id };
          }).filter(r => {
            if (params.cat_id && params.cat_id !== 'all') {
               const allowedCats = getMockDescendants(params.cat_id);
               return allowedCats.includes(r.cat_id);
            }
            if (params.poet_id && params.poet_id !== 'all') return r.poet_id === params.poet_id;
            return true;
          });
        case 'getRandomPoem':
          let pool = MOCK_DB.poems;
          if (params.cat_id) {
             const allowedCats = getMockDescendants(params.cat_id);
             pool = pool.filter(p => allowedCats.includes(p.cat_id));
          } else if (params.poet_id) {
             const rootCats = MOCK_DB.cats.filter(c => c.poet_id === params.poet_id && c.parent_id === 0).map(c => c.id);
             let allowedCats = [];
             rootCats.forEach(rc => allowedCats.push(...getMockDescendants(rc)));
             pool = pool.filter(p => allowedCats.includes(p.cat_id));
          }
          return pool[Math.floor(Math.random() * pool.length)] || null;
        default: return [];
      }
    }

    if (!db) return [];
    const execSql = (sql, bindings = []) => {
      try {
        const stmt = db.prepare(sql);
        stmt.bind(bindings);
        const results = [];
        while(stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
      } catch (e) { console.error("SQL Error:", e, sql); return []; }
    };

    switch(queryName) {
      case 'getPoets': return execSql("SELECT id, name, cat_id, description FROM poet ORDER BY name");
      case 'getCatsByParent': 
        if(params.poet_id) {
            return execSql(`
              SELECT c2.id, c2.text, c2.parent_id 
              FROM cat c1 
              JOIN cat c2 ON c1.id = c2.parent_id 
              WHERE c1.poet_id = ? AND c1.parent_id = 0
            `, [params.poet_id]);
        }
        return execSql("SELECT id, text, parent_id FROM cat WHERE parent_id = ?", [params.parent_id]);
      case 'getCat': return execSql("SELECT id, text, poet_id, parent_id FROM cat WHERE id = ?", [params.id])[0] || null;
      case 'getPoet': return execSql("SELECT id, name, cat_id FROM poet WHERE id = ?", [params.id])[0] || null;
      case 'getPoemsByCat': return execSql("SELECT id, title FROM poem WHERE cat_id = ?", [params.cat_id]);
      case 'getPoem': return execSql("SELECT id, title, cat_id FROM poem WHERE id = ?", [params.id])[0] || null;
      case 'getVerses': return execSql("SELECT position, text, vorder FROM verse WHERE poem_id = ? ORDER BY vorder", [params.poem_id]);
      
      case 'search':
        let bindings = [];
        let cte = '';
        let whereClause = `WHERE v.text LIKE ?`;
        
        if (params.cat_id && params.cat_id !== 'all') {
            cte = `WITH RECURSIVE cat_tree(id) AS (
                     SELECT id FROM cat WHERE id = ?
                     UNION ALL
                     SELECT c.id FROM cat c JOIN cat_tree ct ON c.parent_id = ct.id
                   ) `;
            whereClause += ` AND c.id IN (SELECT id FROM cat_tree)`;
            bindings.push(params.cat_id); 
        }
        
        bindings.push(`%${params.term}%`); 

        if (params.poet_id && params.poet_id !== 'all' && (!params.cat_id || params.cat_id === 'all')) {
            whereClause += ` AND pt.id = ?`;
            bindings.push(params.poet_id);
        }

        return execSql(cte + `
            SELECT v.text, p.title as poem_title, p.id as poem_id, c.text as cat_name, pt.name as poet_name, c.id as cat_id
            FROM verse v 
            JOIN poem p ON v.poem_id = p.id 
            JOIN cat c ON p.cat_id = c.id 
            JOIN poet pt ON c.poet_id = pt.id 
            ${whereClause} LIMIT 50
        `, bindings);
      
      case 'getRandomPoem':
        if (params.poet_id) {
             return execSql(`
                WITH RECURSIVE cat_tree(id) AS (
                    SELECT id FROM cat WHERE poet_id = ? AND parent_id = 0
                    UNION ALL
                    SELECT c.id FROM cat c JOIN cat_tree ct ON c.parent_id = ct.id
                )
                SELECT p.id, p.title, p.cat_id FROM poem p
                JOIN cat_tree ct ON p.cat_id = ct.id
                ORDER BY RANDOM() LIMIT 1
            `, [params.poet_id])[0] || null;
        } else if (params.cat_id) {
            return execSql(`
                WITH RECURSIVE cat_tree(id) AS (
                    SELECT id FROM cat WHERE id = ?
                    UNION ALL
                    SELECT c.id FROM cat c JOIN cat_tree ct ON c.parent_id = ct.id
                )
                SELECT p.id, p.title, p.cat_id FROM poem p
                JOIN cat_tree ct ON p.cat_id = ct.id
                ORDER BY RANDOM() LIMIT 1
            `, [params.cat_id])[0] || null;
        }
        return execSql("SELECT id, title, cat_id FROM poem ORDER BY RANDOM() LIMIT 1")[0] || null;
      default: return [];
    }
  };

  // Helper to construct fully qualified context for random poems
  const buildContextFromCat = (catId) => {
    let ctx = {};
    let currentCat = queryData('getCat', { id: catId });
    if (!currentCat) return ctx;
    
    let catPath = [currentCat];
    let safety = 0;
    while (currentCat.parent_id !== 0 && safety < 10) {
        currentCat = queryData('getCat', { id: currentCat.parent_id });
        if (currentCat) catPath.unshift(currentCat);
        else break;
        safety++;
    }
    
    let poet = queryData('getPoet', { id: catPath[0].poet_id });
    if (poet) {
        ctx.poet_id = poet.id;
        ctx.poet_name = poet.name;
        // Ignore repetitive root category matching poet's name
        if (catPath.length > 1 && catPath[0].text === poet.name) {
            catPath.shift();
        }
    }
    
    if (catPath.length > 0) {
        ctx.book_id = catPath[0].id;
        ctx.book_name = catPath[0].text;
    }
    if (catPath.length > 1) {
        ctx.section_id = catPath[catPath.length - 1].id;
        ctx.section_name = catPath[catPath.length - 1].text;
    }
    return ctx;
  };

  // --- APP NAVIGATION ---
  const navigate = (name, params = {}) => {
    setViewStack([...viewStack, { name, params }]);
    if (name !== 'favorites') setFavSelectedPoetId(null);
  };

  const goBack = () => {
    if (viewStack.length > 1) {
      setViewStack(viewStack.slice(0, -1));
    }
  };

  // Helper to accurately rebuild the full breadcrumb path from scratch
  const navigateToPoemWithPath = (poemId, poemTitle, catId) => {
    const currentStack = [...viewStack]; // Snapshot the exact place user is leaving from (e.g. Search results or Favs list)
    const newStack = [{ name: 'home', params: {} }];
    let currentCat = queryData('getCat', { id: catId });

    if (!currentCat) {
      newStack.push({ name: 'poem', params: { id: poemId, title: poemTitle, ctx: {}, returnStack: currentStack } });
      setViewStack(newStack);
      return;
    }

    let catPath = [currentCat];
    let safety = 0;
    while (currentCat.parent_id !== 0 && safety < 10) {
        currentCat = queryData('getCat', { id: currentCat.parent_id });
        if (currentCat) catPath.unshift(currentCat);
        else break;
        safety++;
    }

    let poet = queryData('getPoet', { id: catPath[0].poet_id });
    let ctx = {};

    if (poet) {
        ctx.poet_id = poet.id;
        ctx.poet_name = poet.name;

        // Add poet root to breadcrumb
        newStack.push({
            name: 'category',
            params: { id: poet.cat_id, title: poet.name, isRoot: true, poet_id: poet.id, ctx: { ...ctx } }
        });

        // Avoid duplicating root cat if it matches poet name
        if (catPath.length > 1 && catPath[0].text === poet.name) {
            catPath.shift();
        }
    }

    // Process remaining categories for breadcrumbs
    catPath.forEach((cat, index) => {
        if (index === 0) {
            ctx.book_id = cat.id;
            ctx.book_name = cat.text;
        } else if (index === catPath.length - 1) {
            ctx.section_id = cat.id;
            ctx.section_name = cat.text;
        }
        newStack.push({
            name: 'category',
            params: { id: cat.id, title: cat.text, isRoot: false, ctx: { ...ctx } }
        });
    });

    // Finally add the poem with the history injected
    newStack.push({ name: 'poem', params: { id: poemId, title: poemTitle, ctx, returnStack: currentStack } });

    setViewStack(newStack);
    if (currentView.name !== 'favorites') setFavSelectedPoetId(null);
  };

  const toggleSelectedPoet = (name) => {
    if (selectedPoetNames.includes(name)) {
      setSelectedPoetNames(selectedPoetNames.filter(n => n !== name));
    } else {
      setSelectedPoetNames([...selectedPoetNames, name]);
    }
  };

  // --- NATIVE APP COMPONENTS ---
  const AppBar = ({ title, showBack, rightAction, onBack }) => (
    <header className="shrink-0 bg-[#35646A] text-[#FAF4ED] shadow-md px-4 py-3 flex items-center justify-between z-40 relative">
      <div className="w-16 flex justify-start">
        {showBack && (
          <button onClick={onBack || goBack} className="p-2 -ml-2 rounded-full hover:bg-white/10 active:bg-white/20 transition-colors">
            <ChevronRight size={24} />
          </button>
        )}
      </div>
      {title? (
          <h1 className="text-lg font-bold truncate flex-1 text-center font-poem text-xl">{title}</h1>
        ):(
          <img src="/logo.png" class="max-h-[100px]"></img>
        )
      }
      <div className="w-16 flex justify-end">
        {rightAction}
      </div>
    </header>
  );

  const Breadcrumbs = () => {
    if (viewStack.length <= 1) return null;
    return (
      <div className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-white/80 border-b border-[#35646A]/10 overflow-x-auto hide-scrollbar whitespace-nowrap text-[11px] sm:text-xs text-[#35646A] font-bold shadow-sm backdrop-blur-md relative z-30">
        {viewStack.map((view, idx) => {
          let title = view.name === 'home' ? 'خانه' :
                      view.name === 'search' ? 'جستجو' :
                      view.name === 'favorites' ? 'نشان‌ها' :
                      view.params.title || 'بدون نام';
          return (
            <React.Fragment key={idx}>
              <button 
                onClick={() => setViewStack(viewStack.slice(0, idx + 1))} 
                className={`active:opacity-50 transition-opacity flex-shrink-0 ${idx === viewStack.length - 1 ? 'opacity-100 text-[#A00A0F]' : 'opacity-70'}`}
              >
                {title}
              </button>
              {idx < viewStack.length - 1 && <ChevronLeft size={12} className="opacity-40 shrink-0"/>}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const BottomNav = () => (
    <nav className="fixed bottom-0 w-full bg-[#FAF4ED]/95 backdrop-blur-md border-t border-[#35646A]/10 px-6 py-2 pb-safe flex justify-between items-center z-50 shadow-[0_-4px_15px_rgba(55,50,50,0.15)]">
      <button onClick={() => { setViewStack([{name: 'home', params: {}}]); setFavSelectedPoetId(null); }} className={`flex flex-col items-center p-2 rounded-xl transition-colors ${currentView.name === 'home' ? 'text-[#A00A0F]' : 'text-[#373232]/60'}`}>
        <Home size={24} className={currentView.name === 'home' ? 'fill-[#A00A0F]/10' : ''} />
        <span className="text-[10px] mt-1 font-bold">خانه</span>
      </button>
      <button onClick={() => navigate('search')} className={`flex flex-col items-center p-2 rounded-xl transition-colors ${currentView.name === 'search' ? 'text-[#A00A0F]' : 'text-[#373232]/60'}`}>
        <Search size={24} />
        <span className="text-[10px] mt-1 font-bold">جستجو</span>
      </button>
      <button onClick={() => navigate('favorites')} className={`flex flex-col items-center p-2 rounded-xl transition-colors ${currentView.name === 'favorites' ? 'text-[#A00A0F]' : 'text-[#373232]/60'}`}>
        <Heart size={24} className={currentView.name === 'favorites' ? 'fill-[#A00A0F]/10' : ''} />
        <span className="text-[10px] mt-1 font-bold">نشان‌ها</span>
      </button>
    </nav>
  );

  const ShareBottomSheet = ({ poem, verses, onClose }) => {
    const [copied, setCopied] = useState(false);

    const cat = queryData('getCat', { id: poem.cat_id });
    const poet = cat ? queryData('getPoet', { id: cat.poet_id }) : null;
    
    let textToShare = verses.map(v => v.text).join('\n');
    textToShare += `\n\n${poet ? poet.name + '، ' : ''}${cat ? cat.text + '، ' : ''}${poem.title}`;
    textToShare += `\nارسال شده از دوست`;

    const copyToClipboard = () => {
      try {
        const el = document.createElement('textarea');
        el.value = textToShare;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) { console.error("Copy failed", e); }
    };

    return (
      <div className="fixed inset-0 bg-[#373232]/60 z-[9999] flex flex-col justify-end">
        <div className="bg-[#FAF4ED] rounded-t-3xl w-full max-w-lg mx-auto p-6 shadow-2xl animate-in slide-in-from-bottom-full duration-300 pb-safe relative">
          <div className="w-12 h-1.5 bg-[#373232]/20 rounded-full mx-auto mb-6"></div>
          <h3 className="text-xl font-bold mb-4 text-[#35646A] border-b border-[#35646A]/10 pb-3">اشتراک‌گذاری شعر</h3>
          
          <div className="bg-white/60 p-4 rounded-2xl text-sm text-[#373232] font-poem whitespace-pre-wrap max-h-[30vh] overflow-y-auto border border-[#35646A]/10 mb-6 shadow-inner hide-scrollbar">
            {textToShare}
          </div>

          <div className="flex gap-3 mb-4">
            <button onClick={onClose} className="px-4 py-3 text-[#373232] bg-[#373232]/5 rounded-xl active:bg-[#373232]/10 transition-colors w-1/3 font-bold">
              بستن
            </button>
            <button onClick={copyToClipboard} className="px-4 py-3 bg-[#35646A] text-[#FAF4ED] rounded-xl active:bg-[#35646A]/80 flex-1 flex justify-center items-center gap-2 transition-colors font-bold shadow-md">
              {copied ? <Check size={20} /> : <Copy size={20} />}
              {copied ? 'کپی شد' : 'کپی در کلیپ‌بورد'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // --- VIEWS ---
  
  const renderHomeView = () => {
    const poets = queryData('getPoets');
    
    // Selected poets for top section
    const selectedPoets = poets.filter(p => selectedPoetNames.includes(p.name));
    
    // All poets (sorted alphabetically) for the bottom section
    const groupedPoets = {};
    const sortedAllPoets = [...poets].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    sortedAllPoets.forEach(p => {
       const firstChar = p.name.trim().charAt(0);
       if (!groupedPoets[firstChar]) groupedPoets[firstChar] = [];
       groupedPoets[firstChar].push(p);
    });

    const getPoetStyle = (id) => {
      const styles = [
        'bg-[#35646A]/[0.08] border-[#35646A]/10 text-[#35646A]', 
        'bg-[#A00A0F]/[0.06] border-[#A00A0F]/10 text-[#A00A0F]', 
        'bg-[#35646A]/[0.05] border-[#35646A]/5 text-[#35646A]', 
        'bg-[#A00A0F]/[0.04] border-[#A00A0F]/5 text-[#A00A0F]',
        'bg-white border-[#35646A]/10 text-[#373232]'
      ];
      return styles[id % styles.length];
    };

    const renderPoetCard = (poet) => {
      const isSelected = selectedPoetNames.includes(poet.name);
      const tint = getPoetStyle(poet.id);
      return (
        <button 
          key={poet.id}
          onClick={() => navigate('category', { 
            id: poet.cat_id, 
            title: poet.name, 
            isRoot: true, 
            poet_id: poet.id,
            ctx: { poet_id: poet.id, poet_name: poet.name }
          })}
          className={`w-full flex flex-row sm:flex-col items-center sm:justify-center border rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm active:scale-[0.98] transition-all h-[72px] sm:h-auto sm:aspect-square relative group ${tint}`}
        >
          <span className="font-bold text-lg sm:text-xl tracking-wide ml-auto sm:ml-0">{poet.name}</span>
          <div 
            onClick={(e) => { e.stopPropagation(); toggleSelectedPoet(poet.name); }}
            className="mr-auto sm:mr-0 sm:mt-auto sm:absolute sm:top-4 sm:right-4 p-2 -m-2 sm:m-0 rounded-full active:bg-black/5 transition-colors"
          >
             <Star size={20} className={isSelected ? "fill-[#A00A0F] text-[#A00A0F]" : "text-[#35646A]/20"} />
          </div>
        </button>
      );
    };

    return (
      <div className="h-full overflow-y-auto view-scroll-container versesbox animate-in fade-in duration-300 pb-24">
        <AppBar title="" showBack={false} />
        
        <div className="p-4 md:p-6 max-w-4xl mx-auto">
          
          {/* Selected Poets */}
          {selectedPoets.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-bold text-[#35646A] flex items-center gap-2 mb-4">
                 <Star size={20} className="fill-[#A00A0F] text-[#A00A0F]" />
                 شاعران منتخب
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                {selectedPoets.map(poet => renderPoetCard(poet))}
              </div>
            </div>
          )}
          
          {/* All Poets (Alphabetical) */}
          <div className="mb-8">
            <h2 className="text-lg font-bold text-[#35646A] flex items-center gap-2 mb-4">
               <Hash size={20} className="text-[#35646A]" />
               همه شاعران
            </h2>
            {Object.keys(groupedPoets).sort((a,b) => a.localeCompare(b, 'fa')).map(letter => (
              <div key={letter} className="mb-6">
                 <h3 className="text-lg font-bold text-[#35646A]/50 mb-3 border-b border-[#35646A]/10 pb-1 px-1">
                   {letter}
                 </h3>
                 <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                    {groupedPoets[letter].map(poet => renderPoetCard(poet))}
                 </div>
              </div>
            ))}
          </div>

          {/* Floating Random Action Button */}
          <button 
            onClick={() => {
              const p = queryData('getRandomPoem');
              if(p) {
                 navigateToPoemWithPath(p.id, p.title, p.cat_id);
              }
            }}
            className="fixed bottom-24 left-6 bg-[#A00A0F] text-[#FAF4ED] p-4 rounded-full shadow-lg active:scale-90 transition-transform z-40 flex items-center gap-2 border-2 border-white/20"
          >
            <Shuffle size={24} />
          </button>
        </div>
      </div>
    );
  };

  const renderCategoryView = ({ id, title, isRoot, poet_id, ctx }) => {
    const subCats = queryData('getCatsByParent', isRoot ? { poet_id } : { parent_id: id });
    const poems = queryData('getPoemsByCat', { cat_id: id });

    return (
      <div className="flex flex-col h-full versesbox animate-in slide-in-from-right-4 duration-300 bg-[#FAF4ED]">
        <div className="shrink-0 z-40 relative">
          <AppBar 
            title={title} 
            showBack={true} 
            rightAction={
              <div className="flex gap-1">
                 <button onClick={() => {
                   setSearchState(prev => ({
                      ...prev,
                      selectedPoet: ctx?.poet_id || 'all',
                      selectedBook: ctx?.book_id || 'all',
                      selectedSection: ctx?.section_id || 'all',
                      showFilters: true
                   }));
                   navigate('search');
                 }} className="p-2 rounded-full hover:bg-white/10 active:bg-white/20">
                   <Search size={20} />
                 </button>
                 <button onClick={() => {
                   const p = queryData('getRandomPoem', isRoot ? { poet_id } : { cat_id: id });
                   if(p) {
                      navigateToPoemWithPath(p.id, p.title, p.cat_id);
                   }
                 }} className="p-2 -mr-1 rounded-full hover:bg-white/10 active:bg-white/20">
                   <Shuffle size={20} />
                 </button>
              </div>
            }
          />
          <Breadcrumbs />
        </div>

        <div className="flex-1 overflow-y-auto view-scroll-container pb-24 p-4 md:p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {subCats.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-[#35646A]/70 mb-2 px-2">بخش‌ها</h3>
                <div className="bg-white/80 backdrop-blur rounded-3xl overflow-hidden shadow-sm border border-[#35646A]/10">
                  {subCats.map((cat, idx) => (
                    <button 
                      key={cat.id} 
                      onClick={() => {
                         let newCtx = { ...ctx };
                         if (!newCtx.book_id || newCtx.book_id === 'all') {
                             newCtx.book_id = cat.id; newCtx.book_name = cat.text;
                         } else {
                             newCtx.section_id = cat.id; newCtx.section_name = cat.text;
                         }
                         navigate('category', { id: cat.id, title: cat.text, isRoot: false, ctx: newCtx });
                      }}
                      className={`w-full px-5 py-4 flex items-center justify-between active:bg-[#35646A]/5 transition-colors text-right ${idx !== subCats.length - 1 ? 'border-b border-[#35646A]/10' : ''}`}
                    >
                      <span className="font-bold text-[#373232] text-sm md:text-base">{cat.text}</span>
                      <ChevronLeft size={18} className="text-[#35646A]/40 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {poems.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-[#35646A]/70 mb-2 px-2">اشعار</h3>
                <div className="bg-white/80 backdrop-blur rounded-3xl overflow-hidden shadow-sm border border-[#35646A]/10">
                  {poems.map((poem, idx) => (
                    <button 
                      key={poem.id} 
                      onClick={() => navigateToPoemWithPath(poem.id, poem.title, id)}
                      className={`w-full px-5 py-4 flex items-center justify-between active:bg-[#A00A0F]/5 transition-colors text-right ${idx !== poems.length - 1 ? 'border-b border-[#35646A]/10' : ''}`}
                    >
                      <span className="text-[#373232] font-semibold text-sm md:text-base">{poem.title}</span>
                      <ChevronLeft size={16} className="text-[#35646A]/30 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {subCats.length === 0 && poems.length === 0 && (
              <div className="text-center text-[#373232]/50 py-16 font-semibold">
                محتوایی در این بخش یافت نشد.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderPoemView = ({ id, title, ctx, returnStack }) => {
    const verses = queryData('getVerses', { poem_id: id });
    const poemObj = queryData('getPoem', { id });
    const isFav = favorites.some(f => f.id === id);

    const toggleFav = () => {
      if (isFav) {
          setFavorites(favorites.filter(f => f.id !== id));
      } else if (poemObj) {
          const fullCtx = buildContextFromCat(poemObj.cat_id);
          setFavorites([...favorites, { 
             id: poemObj.id, 
             title: poemObj.title, 
             cat_id: poemObj.cat_id,
             poet_id: fullCtx.poet_id || 0,
             poet_name: fullCtx.poet_name || 'ناشناس',
             book_name: fullCtx.book_name || '',
             section_name: fullCtx.section_name || ''
          }]);
      }
    };

    const renderVerses = () => {
      const elements = [];
      let i = 0;
      
      while (i < verses.length) {
        const v = verses[i];
        
        // Classic Pair (0 = Right, 1 = Left) - Staggered in ONE line dynamically
        if (v.position === 0) {
          const nextV = verses[i + 1];
          if (nextV && nextV.position === 1) {
            elements.push(
              <div key={`pair-${v.vorder}`} className="w-full mb-6 group flex flex-col gap-1">
                <div className="w-full text-right text-[#373232] font-poem text-lg md:text-xl lg:text-2xl leading-[2.5] pl-4 md:pl-16">
                  {v.text}
                </div>
                <div className="w-full text-left text-[#373232] font-poem text-lg md:text-xl lg:text-2xl leading-[2.5] pr-4 md:pr-16">
                  {nextV.text}
                </div>
              </div>
            );
            i += 2;
            continue;
          }
        }
        
        // Single Center Lines
        if ([2, 3, 4].includes(v.position) || (v.position === 0)) {
           elements.push(
             <div key={`single-${v.vorder}`} className="w-full text-center text-[#373232] font-poem text-lg md:text-xl lg:text-2xl leading-[2.5] mb-5">
               {v.text}
             </div>
           );
        }
        // Prose/Comment - Removed green box completely, just text style
        else if (v.position === 5 || v.position === -1) {
           elements.push(
             <div key={`prose-${v.vorder}`} className="w-full text-justify text-[#373232]/80 leading-relaxed mb-6 text-sm md:text-base font-semibold">
               {v.text}
             </div>
           );
        }
        i++;
      }
      return elements;
    };

    return (
      <div className="flex flex-col h-full versesbox animate-in fade-in duration-300 bg-[#FAF4ED]">
        <div className="shrink-0 z-40 relative">
          <AppBar 
            title={title} 
            showBack={true} 
            onBack={returnStack ? () => setViewStack(returnStack) : undefined}
            rightAction={
              <div className="flex gap-1">
                <button onClick={() => {
                   setSearchState(prev => ({
                      ...prev,
                      selectedPoet: ctx?.poet_id || 'all',
                      selectedBook: ctx?.book_id || 'all',
                      selectedSection: ctx?.section_id || 'all',
                      showFilters: true
                   }));
                   navigate('search');
                }} className="p-2 rounded-full active:bg-white/20 transition-colors">
                  <Search size={20} />
                </button>
                <button onClick={toggleFav} className="p-2 rounded-full active:bg-white/20 transition-colors">
                  <Heart size={20} className={isFav ? "fill-white text-white" : ""} />
                </button>
                <button onClick={() => setShareData({ poem: poemObj, verses })} className="p-2 -mr-1 rounded-full active:bg-white/20 transition-colors">
                  <Share2 size={20} />
                </button>
              </div>
            }
          />
          <Breadcrumbs />
        </div>

        <div className="flex-1 overflow-y-auto view-scroll-container pb-24 relative">
          <div className="persian-pattern absolute inset-0 z-[-1]"></div>
          <div className="max-w-3xl mx-auto py-8 px-5 md:px-10 relative">
            {renderVerses()}
          </div>
        </div>
      </div>
    );
  };

  const renderSearchView = () => {
    const { term, results, hasSearched, showFilters, selectedPoet, selectedBook, selectedSection } = searchState;
    const updateSearch = (updates) => setSearchState(prev => ({ ...prev, ...updates }));

    // Filter Data
    const poets = queryData('getPoets');
    const books = selectedPoet !== 'all' ? queryData('getCatsByParent', { poet_id: selectedPoet }) : [];
    const sections = selectedBook !== 'all' ? queryData('getCatsByParent', { parent_id: selectedBook }) : [];

    // Handlers
    const handlePoetChange = (e) => {
      updateSearch({
          selectedPoet: e.target.value === 'all' ? 'all' : Number(e.target.value),
          selectedBook: 'all',
          selectedSection: 'all'
      });
    };
    
    const handleBookChange = (e) => {
      updateSearch({
          selectedBook: e.target.value === 'all' ? 'all' : Number(e.target.value),
          selectedSection: 'all'
      });
    };

    const handleSearch = (e) => {
      e.preventDefault();
      if (!term.trim()) return;
      
      const targetCat = selectedSection !== 'all' ? selectedSection : (selectedBook !== 'all' ? selectedBook : 'all');
      const res = queryData('search', { 
         term: term.trim(), 
         poet_id: selectedPoet, 
         cat_id: targetCat 
      });
      
      updateSearch({ results: res, hasSearched: true, showFilters: false });
      document.activeElement.blur();
    };

    return (
      <div className="flex flex-col h-full versesbox animate-in fade-in duration-300 bg-[#FAF4ED]">
        <div className="shrink-0 z-40 relative bg-[#FAF4ED] shadow-sm pb-4 rounded-b-3xl border-b border-[#35646A]/10">
          <AppBar title="جستجوی پیشرفته" showBack={false} rightAction={
             <button onClick={() => updateSearch({ showFilters: !showFilters })} className={`p-2 rounded-full transition-colors ${showFilters ? 'bg-white/20' : 'active:bg-white/20'}`}>
                <Filter size={20} />
             </button>
          }/>
          
          <div className="px-4 md:px-6 max-w-3xl mx-auto mt-4">
            {/* Advanced Filters Panel */}
            {showFilters && (
              <div className="bg-white p-5 rounded-3xl border border-[#35646A]/10 shadow-sm mb-4 animate-in slide-in-from-top-2">
                 <h3 className="text-[#35646A] font-bold mb-4 text-sm flex items-center gap-2"><Filter size={16}/> فیلترهای جستجو</h3>
                 <div className="space-y-3">
                    <div>
                      <label className="text-xs text-[#373232]/70 font-bold mb-1 block">شاعر</label>
                      <select value={selectedPoet} onChange={handlePoetChange} className="w-full bg-[#FAF4ED] border border-[#35646A]/20 rounded-xl p-3 text-sm font-semibold text-[#373232] outline-none focus:border-[#35646A]">
                         <option value="all">همه موارد</option>
                         {poets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    
                    {selectedPoet !== 'all' && books.length > 0 && (
                      <div>
                        <label className="text-xs text-[#373232]/70 font-bold mb-1 block">کتاب / بخش اصلی</label>
                        <select value={selectedBook} onChange={handleBookChange} className="w-full bg-[#FAF4ED] border border-[#35646A]/20 rounded-xl p-3 text-sm font-semibold text-[#373232] outline-none focus:border-[#35646A]">
                           <option value="all">همه موارد</option>
                           {books.map(b => <option key={b.id} value={b.id}>{b.text}</option>)}
                        </select>
                      </div>
                    )}

                    {selectedBook !== 'all' && sections.length > 0 && (
                      <div>
                        <label className="text-xs text-[#373232]/70 font-bold mb-1 block">بخش فرعی</label>
                        <select value={selectedSection} onChange={e => updateSearch({ selectedSection: e.target.value === 'all' ? 'all' : Number(e.target.value) })} className="w-full bg-[#FAF4ED] border border-[#35646A]/20 rounded-xl p-3 text-sm font-semibold text-[#373232] outline-none focus:border-[#35646A]">
                           <option value="all">همه موارد</option>
                           {sections.map(s => <option key={s.id} value={s.id}>{s.text}</option>)}
                        </select>
                      </div>
                    )}
                 </div>
              </div>
            )}

            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <input 
                  type="text" 
                  value={term}
                  onChange={e => updateSearch({ term: e.target.value })}
                  placeholder="جستجو در متن اشعار..."
                  className="w-full pl-4 pr-12 py-4 bg-white border border-[#35646A]/20 rounded-2xl focus:outline-none focus:border-[#35646A] focus:ring-1 focus:ring-[#35646A] transition-all text-[#373232] font-semibold shadow-sm"
                />
                <Search className="absolute right-4 top-4 text-[#35646A]/50" size={24} />
              </div>
              <button type="submit" className="bg-[#35646A] text-[#FAF4ED] px-6 rounded-2xl active:bg-[#35646A]/80 font-bold transition-colors shadow-md">
                بگرد
              </button>
            </form>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto view-scroll-container p-4 md:p-6 pb-24">
          <div className="max-w-3xl mx-auto space-y-4">
            {hasSearched && (
              <>
                <h3 className="text-sm font-bold text-[#35646A]/70 px-2 flex justify-between">
                  <span>{results.length} نتیجه یافت شد</span>
                  {(selectedPoet !== 'all' || selectedBook !== 'all') && (
                     <span className="bg-[#35646A]/10 text-[#35646A] px-2 py-0.5 rounded text-[10px]">فیلتر اعمال شده</span>
                  )}
                </h3>
                
                <div className="space-y-3">
                  {results.map((res, i) => (
                    <button 
                      key={i} 
                      onClick={() => navigateToPoemWithPath(res.poem_id, res.poem_title, res.cat_id)}
                      className="w-full text-right bg-white p-5 rounded-3xl border border-[#35646A]/10 shadow-sm active:scale-[0.98] transition-all"
                    >
                      <p className="font-poem text-lg md:text-xl text-[#373232] mb-4 leading-[2]">
                        ... <span className="bg-[#A00A0F]/10 text-[#A00A0F] px-1 rounded">{res.text}</span> ...
                      </p>
                      <div className="flex flex-wrap items-center text-[10px] md:text-xs text-[#373232]/60 gap-1 md:gap-2 font-bold bg-[#FAF4ED] self-start inline-flex px-3 py-2 rounded-lg border border-[#35646A]/5">
                        <span className="text-[#35646A]">{res.poet_name}</span>
                        <ChevronLeft size={10} className="opacity-50" />
                        <span>{res.cat_name}</span>
                        <ChevronLeft size={10} className="opacity-50" />
                        <span className="text-ellipsis overflow-hidden whitespace-nowrap max-w-[100px] sm:max-w-none">{res.poem_title}</span>
                      </div>
                    </button>
                  ))}
                  
                  {results.length === 0 && (
                    <div className="text-center py-16 text-[#373232]/40 font-bold bg-white/50 rounded-3xl border border-[#35646A]/10 border-dashed">
                      نتیجه‌ای برای «{term}» یافت نشد.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderFavoritesView = () => {
    // Group favorites by poet dynamically
    const grouped = {};
    favorites.forEach(fav => {
       // Fallback for older saved favorites before update
       let pId = fav.poet_id;
       let pName = fav.poet_name;
       let bName = fav.book_name;
       let sName = fav.section_name;

       if (!pName) {
           const ctx = buildContextFromCat(fav.cat_id);
           pId = ctx.poet_id || 0;
           pName = ctx.poet_name || 'ناشناس';
           bName = ctx.book_name || '';
           sName = ctx.section_name || '';
       }

       if (!grouped[pId]) {
           grouped[pId] = { name: pName, count: 0, items: [] };
       }
       grouped[pId].count++;
       grouped[pId].items.push({ ...fav, book_name: bName, section_name: sName });
    });

    const poetsList = Object.keys(grouped).map(k => ({ id: k, ...grouped[k] }));

    // Selected Poet's Poems View
    if (favSelectedPoetId && grouped[favSelectedPoetId]) {
       const selectedGroup = grouped[favSelectedPoetId];
       return (
         <div className="flex flex-col h-full versesbox animate-in slide-in-from-right-4 duration-300 bg-[#FAF4ED]">
           <div className="shrink-0 z-40 relative">
             <AppBar 
               title={`نشان‌های ${selectedGroup.name}`} 
               showBack={true} 
               onBack={() => setFavSelectedPoetId(null)}
             />
           </div>
           <div className="flex-1 overflow-y-auto view-scroll-container pb-24 p-4 md:p-6">
              <div className="max-w-3xl mx-auto space-y-3">
                {selectedGroup.items.map(fav => (
                   <button 
                     key={fav.id} 
                     onClick={() => navigateToPoemWithPath(fav.id, fav.title, fav.cat_id)}
                     className="w-full bg-white p-5 rounded-3xl border border-[#35646A]/10 shadow-sm active:scale-[0.98] transition-all flex justify-between items-center text-right"
                   >
                     <div>
                       <h3 className="font-bold text-[#373232] text-lg mb-1">{fav.title}</h3>
                       <span className="text-xs text-[#35646A]/70 font-semibold flex items-center gap-1">
                          <BookOpen size={12} /> 
                          {[fav.book_name, fav.section_name].filter(Boolean).join('، ') || 'بدون دسته‌بندی'}
                       </span>
                     </div>
                     <div className="w-10 h-10 bg-[#FAF4ED] rounded-full flex items-center justify-center shrink-0">
                        <ChevronLeft size={20} className="text-[#A00A0F]" />
                     </div>
                   </button>
                ))}
              </div>
           </div>
         </div>
       );
    }

    // Default Poets List View
    return (
      <div className="flex flex-col h-full versesbox animate-in fade-in duration-300 bg-[#FAF4ED]">
        <div className="shrink-0 z-40 relative">
          <AppBar title="نشان‌ها" showBack={false} />
        </div>
        <div className="flex-1 overflow-y-auto view-scroll-container pb-24 p-4 md:p-6">
          <div className="max-w-3xl mx-auto">
            {poetsList.length === 0 ? (
              <div className="text-center py-20 flex flex-col items-center">
                <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm border border-[#35646A]/5">
                   <Heart size={40} className="text-[#35646A]/20" />
                </div>
                <p className="text-[#373232]/60 font-bold text-lg">هیچ شعری را هنوز نشان نکرده‌اید.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {poetsList.map(poet => (
                  <button 
                    key={poet.id} 
                    onClick={() => setFavSelectedPoetId(poet.id)}
                    className="w-full bg-white p-5 rounded-3xl border border-[#35646A]/10 shadow-sm active:scale-[0.98] transition-all flex justify-between items-center text-right"
                  >
                    <div>
                      <h3 className="font-bold text-[#373232] text-lg mb-1">{poet.name}</h3>
                      <span className="text-xs text-[#35646A]/70 font-semibold flex items-center gap-1">
                         <BookOpen size={12} /> {poet.count} شعر نشان شده
                      </span>
                    </div>
                    <div className="w-10 h-10 bg-[#FAF4ED] rounded-full flex items-center justify-center shrink-0">
                       <ChevronLeft size={20} className="text-[#A00A0F]" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // --- SPLASH SCREEN (DB Loading) ---
  if (appLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#35646A] text-[#FAF4ED] relative overflow-hidden">
        <div className="absolute inset-0 persian-pattern opacity-10 mix-blend-overlay"></div>
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-48 h-48 bg-[rgb(250 244 237 / 43%)] rounded-3xl shadow-2xl flex items-center justify-center mb-8 rotate-3">
            <img src="/logo.png"></img>
          </div>
          <p className="text-[#FAF4ED]/70 font-medium mb-12">گنجینه شعر و ادب پارسی</p>
          <Loader2 className="animate-spin text-[#FAF4ED]/50" size={32} />
        </div>
      </div>
    );
  }

  // --- MAIN APP STRUCTURE ---
  return (
    <div className="h-[100dvh] bg-[#FAF4ED] relative w-full max-w-md md:max-w-none mx-auto shadow-2xl md:shadow-none overflow-hidden flex flex-col">
      <main className="flex-1 w-full relative bg-transparent overflow-hidden">
        {currentView.name === 'home' && renderHomeView()}
        {currentView.name === 'category' && renderCategoryView(currentView.params)}
        {currentView.name === 'poem' && renderPoemView(currentView.params)}
        {currentView.name === 'search' && renderSearchView()}
        {currentView.name === 'favorites' && renderFavoritesView()}
      </main>
      
      <BottomNav />
      
      {/* Moved ShareBottomSheet to Root to escape any local z-index stacking contexts */}
      {shareData && <ShareBottomSheet poem={shareData.poem} verses={shareData.verses} onClose={() => setShareData(null)} />}
    </div>
  );
}