/* ==========================================
   ⚙️ إعدادات محرك التغذية (Feed Configuration)
   ========================================== */
const FeedConfig = {
    injectSuggestionsAt: 3,  // متى يظهر صندوق الاقتراحات
    injectDiscoveryAt: 8,    // متى يظهر صندوق صناع المحتوى
    maxFriendsPerFetch: 4,   // عدد منشورات الأصدقاء في كل سحبة
    maxSuggestedPerFetch: 1, // عدد المنشورات المقترحة في كل سحبة
    enableRealtime: true     // تفعيل إشعارات المنشورات الجديدة
};

/* ==========================================
   🧩 دوال حقن القوائم وسط المنشورات (Injection System)
   ========================================== */
window.feedPostCounter = 0; 

function injectSuggestedFriendsBox(atTop = false) {
    if (document.getElementById('injected-suggestions-wrapper')) {
        if (atTop) {
            const wrapper = document.getElementById('injected-suggestions-wrapper');
            document.getElementById('postsList').prepend(wrapper);
        }
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'injected-suggestions-wrapper';
    wrapper.innerHTML = '<div class="loader-box"><i class="fa-solid fa-circle-notch fa-spin"></i> جاري جلب الاقتراحات...</div>';
    
    const list = document.getElementById('postsList');
    atTop ? list.prepend(wrapper) : list.appendChild(wrapper);

    if (typeof renderSuggestedFriendsSection === 'function') {
        renderSuggestedFriendsSection().then(html => {
            wrapper.innerHTML = (html && html.trim() !== "") ? html : '';
            wrapper.style.display = (html && html.trim() !== "") ? 'block' : 'none';
        }).catch(() => wrapper.style.display = 'none');
    }
}

function injectDiscoveryBox() {
    if (document.getElementById('injected-discovery-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'injected-discovery-wrapper';
    wrapper.innerHTML = `
        <div class="discovery-container">
            <div class="discovery-title">🌟 صناع محتوى مميزين</div>
            <div class="discovery-subtitle">أشخاص يستحقون المتابعة</div>
            <div class="discovery-carousel" id="discoveryCarousel">
                <div class="loader-box"><i class="fa-solid fa-circle-notch fa-spin"></i> جاري البحث...</div>
            </div>
        </div>
    `;
    document.getElementById('postsList').appendChild(wrapper);

    if (typeof initDiscoverySystem === 'function') initDiscoverySystem();
}

// =========================================================================
// 🧠 محرك تغذية المنشورات المدمج (Wareed Feed Engine - V5.0 Pro)
// =========================================================================

const FeedEngine = {
    isLoading: false,
    lastVisibleFriendDoc: null,
    lastVisibleSuggestedDoc: null,
    currentMode: 'mixed',
    suggestedShown: new Set(),
    friendsShown: new Set(),
    realtimeUnsubscribe: null,
    newPostsQueue: 0, // عداد المنشورات الجديدة في الخلفية

    // 1. التهيئة وبدء التشغيل مع الذاكرة المخبأة
    init: async function(restoreState = false) {
        console.log("🚀 Feed Engine Initialized - V5.0 Pro");
        
        // استعادة الحالة إذا كان المستخدم عائداً من صفحة أخرى (Caching Prep)
        if (restoreState && sessionStorage.getItem('feedState')) {
            this.restoreFeedState();
            return;
        }

        this.reset();
        
        if (typeof fetchMyFollowing === 'function') await fetchMyFollowing();
        if (typeof fetchBlockedUsersList === 'function') await fetchBlockedUsersList();
        
        if (typeof myFollowingList !== 'undefined' && currentUser) {
            if (!myFollowingList.includes(currentUser.uid)) myFollowingList.push(currentUser.uid);
        }

        if (typeof myFollowingList !== 'undefined' && myFollowingList.length <= 3) {
            setTimeout(() => injectSuggestedFriendsBox(true), 100); 
        }

        this.setupInfiniteScroll();
        await this.loadFeed();

        if (FeedConfig.enableRealtime) this.setupRealtimeUpdates();
    },

    reset: function() {
        this.lastVisibleFriendDoc = null;
        this.lastVisibleSuggestedDoc = null;
        this.currentMode = 'mixed';
        this.suggestedShown.clear();
        this.friendsShown.clear();
        this.isLoading = false;
        this.newPostsQueue = 0;
        window.feedPostCounter = 0; 
        
        const list = document.getElementById('postsList');
        if (list) list.innerHTML = ""; 
        
        this.removeNewPostsBanner();
    },

    setupInfiniteScroll: function() {
        const sentinel = document.getElementById('scrollSentinel');
        if (!sentinel) return;

        if (this.observer) this.observer.disconnect();

        this.observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !this.isLoading && this.currentMode !== 'end') {
                this.loadFeed(true);
            }
        }, { rootMargin: '400px' }); // مساحة استباقية ممتازة

        this.observer.observe(sentinel);
    },

    loadFeed: async function(isMore = false) {
        if (this.isLoading || this.currentMode === 'end') return;
        this.isLoading = true; 
        
        if (typeof startLoadingBar === "function") startLoadingBar();
        this.toggleSentinelUI(true, isMore);

        try {
            const friendsGotPosts = await this.fetchFriendsPosts(isMore);
            const suggestedGotPosts = await this.fetchSuggestedPosts(FeedConfig.maxSuggestedPerFetch);

            if (!friendsGotPosts && !suggestedGotPosts) {
                this.showEndOfFeed();
            } else {
                this.toggleSentinelUI(false);
                this.saveFeedState(); // حفظ الحالة بعد كل تحديث ناجح
            }
        } catch (error) {
            console.error("Feed Engine Error:", error);
            this.showErrorState(isMore);
        } finally {
            this.isLoading = false;
            if (typeof finishLoadingBar === "function") finishLoadingBar();
        }
    },

    // 5. جلب منشورات الأصدقاء (تم حل مشكلة الـ 30 عبر تقسيم القوائم Chunking)
    fetchFriendsPosts: async function(isMore) {
        if (typeof myFollowingList === 'undefined' || myFollowingList.length === 0) return false;

        // تقسيم المتابعين إلى مجموعات من 30 لحل مشكلة قيد Firebase
        const followingChunks = [];
        for (let i = 0; i < myFollowingList.length; i += 30) {
            followingChunks.push(myFollowingList.slice(i, i + 30));
        }

        let allDocs = [];
        
        // جلب المنشورات من جميع المجموعات (Client-Side Aggregation)
        // ملاحظة: للاحترافية القصوى مستقبلاً، يجب نقل هذا إلى Server-Side Timeline
        for (const chunk of followingChunks) {
            let q = db.collection('posts')
                      .where('uid', 'in', chunk)
                      .orderBy('createdAt', 'desc')
                      .limit(FeedConfig.maxFriendsPerFetch);

            if (isMore && this.lastVisibleFriendDoc) {
                q = q.startAfter(this.lastVisibleFriendDoc);
            }

            const snap = await q.get();
            allDocs = allDocs.concat(snap.docs);
        }

        // ترتيب النتائج المجمعة زمنياً
        allDocs.sort((a, b) => b.data().createdAt - a.data().createdAt);
        
        // أخذ العدد المطلوب فقط
        const finalDocs = allDocs.slice(0, FeedConfig.maxFriendsPerFetch);

        if (finalDocs.length === 0) return false;

        const listHTML = document.getElementById('postsList').innerHTML;
        if (!isMore && listHTML.includes('skeleton')) {
            document.getElementById('postsList').innerHTML = ""; 
        }

        // حفظ آخر عنصر كمرجع للسحبة القادمة
        this.lastVisibleFriendDoc = finalDocs[finalDocs.length - 1];
        let renderedCount = 0;

        for (const doc of finalDocs) {
            const p = doc.data();
            if (typeof blockedUsersSet !== 'undefined' && blockedUsersSet.has(p.uid)) continue; 
            if (this.friendsShown.has(doc.id)) continue;

            await renderPost({ id: doc.id, ...p });
            window.feedPostCounter++;
            
            this.checkInjections();

            this.friendsShown.add(doc.id); 
            renderedCount++;
        }

        return renderedCount > 0;
    },

    fetchSuggestedPosts: async function(limitCount = 1) {
        let q = db.collection('posts')
                  .where('privacy', '==', 'public')
                  // في التطبيقات الاحترافية هنا نستخدم orderBy('engagementScore', 'desc')
                  .orderBy('createdAt', 'desc') 
                  .limit(limitCount + 5); 

        if (this.lastVisibleSuggestedDoc) {
            q = q.startAfter(this.lastVisibleSuggestedDoc);
        }

        const snap = await q.get();
        if (snap.empty) return false;

        this.lastVisibleSuggestedDoc = snap.docs[snap.docs.length - 1];
        let renderedCount = 0;

        for (const doc of snap.docs) {
            const p = doc.data();
            if (this.suggestedShown.has(doc.id)) continue; 
            if (typeof blockedUsersSet !== 'undefined' && blockedUsersSet.has(p.uid)) continue; 
            if (typeof myFollowingList !== 'undefined' && myFollowingList.includes(p.uid)) continue; 

            await renderPost({ id: doc.id, ...p, isSuggested: true });
            window.feedPostCounter++;
            
            this.checkInjections();

            this.suggestedShown.add(doc.id);
            renderedCount++;
            
            this.applySuggestedBadge(doc.id);

            if (renderedCount >= limitCount) break; 
        }

        return renderedCount > 0;
    },

    // التأكد من متى نحقن القوائم بناءً على الإعدادات
    checkInjections: function() {
        if (window.feedPostCounter === FeedConfig.injectSuggestionsAt) injectSuggestedFriendsBox(false);
        if (window.feedPostCounter === FeedConfig.injectDiscoveryAt) injectDiscoveryBox();
    },

    applySuggestedBadge: function(docId) {
        setTimeout(() => {
            const postDiv = document.getElementById(`unit-${docId}`);
            if (postDiv) {
                const header = postDiv.querySelector('.name-row-container');
                if(header && !header.querySelector('.suggested-badge')) {
                    header.insertAdjacentHTML('beforeend', `<div class="suggested-badge" style="margin-right:auto; background:rgba(0, 198, 255, 0.1); color:var(--primary-color); padding:2px 8px; border-radius:10px; font-size:10px; border:1px solid var(--primary-color);"><i class="fa-solid fa-star"></i> مقترح لك</div>`);
                }
            }
        }, 100);
    },

    // 🌟 ميزة التحديثات الحية الناعمة (Soft Real-time Updates)
    setupRealtimeUpdates: function() {
        if (this.realtimeUnsubscribe) this.realtimeUnsubscribe();
        if (!myFollowingList || myFollowingList.length === 0) return;

        const now = firebase.firestore.Timestamp.now();
        
        // نراقب أول 30 شخص فقط لتخفيف الحمل (كمثال)
        const monitorList = myFollowingList.slice(0, 30);

        this.realtimeUnsubscribe = db.collection('posts')
            .where('uid', 'in', monitorList)
            .where('createdAt', '>', now)
            .onSnapshot(snapshot => {
                snapshot.docChanges().forEach(change => {
                    if (change.type === "added") {
                        this.newPostsQueue++;
                        this.showNewPostsBanner();
                    }
                });
            });
    },

    showNewPostsBanner: function() {
        let banner = document.getElementById('new-posts-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'new-posts-banner';
            banner.style.cssText = "position:sticky; top:10px; z-index:100; text-align:center; margin-bottom:15px;";
            banner.innerHTML = `<button onclick="window.scrollTo(0,0); FeedEngine.init();" style="background:var(--primary-color); color:#fff; border:none; padding:8px 20px; border-radius:20px; font-weight:bold; box-shadow:0 4px 10px rgba(0,0,0,0.2); cursor:pointer;"><i class="fa-solid fa-arrow-up"></i> هناك منشورات جديدة</button>`;
            document.getElementById('postsList').prepend(banner);
        }
    },

    removeNewPostsBanner: function() {
        const banner = document.getElementById('new-posts-banner');
        if (banner) banner.remove();
    },

    // 💾 حفظ واستعادة الحالة لتجربة مستخدم سلسة (Basic Caching)
    saveFeedState: function() {
        const listHTML = document.getElementById('postsList').innerHTML;
        // يتم حفظ الهيكل الأساسي فقط لتقليل مساحة التخزين
        sessionStorage.setItem('feedState', listHTML);
    },

    restoreFeedState: function() {
        const savedHTML = sessionStorage.getItem('feedState');
        if (savedHTML) {
            document.getElementById('postsList').innerHTML = savedHTML;
            this.setupInfiniteScroll(); // إعادة تفعيل مراقب السحب
        } else {
            this.init(); // إذا لم يوجد حفظ، ابدأ من جديد
        }
    },

    showEndOfFeed: function() { /* نفس الكود الخاص بك دون تغيير لتوفير المساحة */ },
    toggleSentinelUI: function(show, isMore = false) { /* نفس الكود الخاص بك */ },
    showErrorState: function(isMore) { /* نفس الكود الخاص بك */ }
};
