/*
 * Nextel Connect — Tasks Engine
 * ----------------------------------------------------------------
 * Ported from nextel-asstCeo. Adds:
 *   • Activation gate           (nextel_account_active)
 *   • Call simulator engine     (3 contacts, audio, ₦6,100/call, 3/day)
 *   • Favorites sponsor loop    (12 brands, ₦1,028/save, 4/day)
 *   • Withdrawal threshold      (₦15,000 gate + E-SIM code verify)
 *   • eSIM plan chooser         (Diamond ₦10,500 / Royal ₦17,500)
 *
 * All state lives in localStorage. Loads after auth.js.
 */
(function () {
    'use strict';

    /* ====================================================================
     * CONSTANTS  (verbatim from nextel-asstCeo)
     * ==================================================================== */
    var CONST = {
        SIGNUP_BONUS:        10000,
        CALL_DISPLAY_MAX:    2100,
        CALL_CREDIT:         2100,
        CALL_DURATION:       8000,
        CALL_STEP:           50,
        CALL_RING_DELAY:     3000,
        CALL_DAILY_LIMIT:    3,
        HISTORY_CAP:         10,
        FAV_LIMIT:           4,
        FAV_REWARD:          1028,
        FAV_RESET_WINDOW:    86400000,
        WITHDRAW_THRESHOLD:  15000,
        WITHDRAW_AMOUNT:     15000,
        DIAMOND_PRICE:       10500,
        ROYAL_PRICE:         17500,
        STORAGE_SLOTS:       10,
    };

    var SPONSORS = [
        { name: 'Marcus',  brand: 'Spotify',    rate: 540 },
        { name: 'Kevin',   brand: 'Binance',    rate: 628 },
        { name: 'Rachel',  brand: 'Bybit',      rate: 600 },
        { name: 'Victor',  brand: 'KuCoin',     rate: 570 },
        { name: 'Helen',   brand: 'AliExpress', rate: 500 },
        { name: 'Daniel',  brand: 'PalmPay',    rate: 615 },
        { name: 'Grace',   brand: 'Moniepoint', rate: 650 },
        { name: 'Emma',    brand: 'Temu',       rate: 530 },
        { name: 'Sophia',  brand: 'Netflix',    rate: 560 },
        { name: 'David',   brand: 'FairMoney',  rate: 605 },
        { name: 'Joy',     brand: 'SportyBet',  rate: 590 },
        { name: 'Samuel',  brand: 'Opay',       rate: 620 }
    ];

    var PHONEBOOK = [
        { name: 'Linda', brand: 'OKash',   phone: '0700-OKSH-01', rate: 628 },
        { name: 'James', brand: 'PalmPay', phone: '0700-PLMP-02', rate: 628 },
        { name: 'Sarah', brand: 'Opay',    phone: '0700-OPAY-03', rate: 628 }
    ];

    var SPONSOR_AUDIO = {
        Linda: ['https://files.catbox.moe/263shr.mp3',
                'https://files.catbox.moe/3321dg.mp3',
                'https://files.catbox.moe/h2wi2v.mp3'],
        James: ['https://files.catbox.moe/i9f9gb.mp3',
                'https://files.catbox.moe/r4tcw9.mp3',
                'https://files.catbox.moe/plfzly.mp3'],
        Sarah: ['https://files.catbox.moe/9vjl7e.mp3',
                'https://files.catbox.moe/3akaeh.mp3',
                'https://files.catbox.moe/lf4mkb.mp3']
    };

    var ACTIVATION_CODES = [
        'NXT-951756178','NXT-284715903','NXT-638491275','NXT-715204986',
        'NXT-460918372','NXT-127594683','NXT-852716490','NXT-349185627',
        'NXT-906417258','NXT-571263849','NXT-248719635','NXT-615438927',
        'NXT-794521863','NXT-183674952','NXT-427915386','NXT-568243719',
        'NXT-739615824','NXT-294861537','NXT-845297163','NXT-316754928',
        'NXT-924681375','NXT-517293846','NXT-682154739','NXT-145879326',
        'NXT-358926471','NXT-471638295','NXT-863275914','NXT-296418753',
        'NXT-734829561','NXT-581746392','NXT-972413685','NXT-264785913',
        'NXT-613927548','NXT-748561239','NXT-459873126','NXT-136594872',
        'NXT-827461953','NXT-594238617','NXT-315876429','NXT-781452963',
        'NXT-254963871','NXT-698741352','NXT-843216795','NXT-572894136',
        'NXT-917364528','NXT-384527691','NXT-625198473','NXT-148736952',
        'NXT-753281649','NXT-486952731'
    ];

    /* ====================================================================
     * STORAGE KEYS  (prefix with nx_ to match auth.js conventions)
     * ==================================================================== */
    var K = {
        ACTIVE:    'nx_account_active',     // "true"/"false"
        EARNINGS:  'nx_total_earnings',     // number, default 10000
        CALL_DATA: 'nx_call_data',          // {date, counts, history}
        FAVORITES: 'nx_favorites',          // [{name,brand,rate}]
        FAV_LIMIT: 'nx_favorite_limit',     // {count, reset}
        SAVED:     'nx_saved_contacts',     // int
        CODES:     'nx_activation_codes',   // [string]
        WITHDRAW:  'nx_withdrawals',        // [{amount, status, date, time}]
        PLAN:      'nx_esim_plan'           // "premium" | "elite"
    };

    function get(key, fb) {
        try { var v = localStorage.getItem(key); return v == null ? fb : JSON.parse(v); }
        catch (_) { return fb; }
    }
    function set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

    /* ====================================================================
     * STATE
     * ==================================================================== */
    function isActive()          { return localStorage.getItem(K.ACTIVE) === 'true'; }
    function setActive(v)        { localStorage.setItem(K.ACTIVE, v ? 'true' : 'false'); }
    function earnings()          { return Number(localStorage.getItem(K.EARNINGS)) || CONST.SIGNUP_BONUS; }
    function setEarnings(n)      { localStorage.setItem(K.EARNINGS, String(Number(n) || 0)); }
    function addEarnings(n, label, wallet) {
        var amt = Number(n) || 0;
        setEarnings(earnings() + amt);
        // Also push a transaction so auth.js computeBalances() picks it up.
        if (window.NexAuth && NexAuth.store) {
            NexAuth.store.addTx({
                label: label || 'Task reward',
                amount: amt,
                wallet: wallet || 'total',
                type: 'earn'
            });
        }
        return earnings();
    }

    function callData() {
        var today = new Date().toISOString().slice(0, 10);
        var d = get(K.CALL_DATA, null);
        if (!d || d.date !== today) {
            d = { date: today, counts: { Linda: 0, James: 0, Sarah: 0 }, history: [] };
            set(K.CALL_DATA, d);
        }
        return d;
    }
    function canCall(name)       { return (callData().counts[name] || 0) < CONST.CALL_DAILY_LIMIT; }
    function recordCall(name, amt) {
        var d = callData();
        d.counts[name] = (d.counts[name] || 0) + 1;
        d.history.unshift({
            name: name, amount: amt,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        if (d.history.length > CONST.HISTORY_CAP) d.history.length = CONST.HISTORY_CAP;
        set(K.CALL_DATA, d);
    }

    function favorites()         { return get(K.FAVORITES, []); }
    function favLimit() {
        var now = Date.now();
        var d = get(K.FAV_LIMIT, null);
        if (!d || !d.reset || now - d.reset >= CONST.FAV_RESET_WINDOW) {
            d = { count: 0, reset: now };
            set(K.FAV_LIMIT, d);
        }
        return d;
    }
    function bumpFavLimit()      { var d = favLimit(); d.count++; set(K.FAV_LIMIT, d); }

    function activationCodes() {
        var c = get(K.CODES, null);
        if (!c) { c = ACTIVATION_CODES.slice(); set(K.CODES, c); }
        return c;
    }
    function consumeCode(code) {
        var c = activationCodes();
        var i = c.indexOf(code);
        if (i > -1) { c.splice(i, 1); set(K.CODES, c); return true; }
        return false;
    }

    function withdrawals()       { return get(K.WITHDRAW, []); }
    function addWithdrawal(w)    { var l = withdrawals(); l.unshift(w); set(K.WITHDRAW, l); }

    function plan()              { return localStorage.getItem(K.PLAN) || null; }
    function setPlan(p)          { localStorage.setItem(K.PLAN, p); }

    /* ====================================================================
     * HELPERS
     * ==================================================================== */
    function money(n) { return '₦' + Number(n).toLocaleString(); }
    function $(s, c)  { return (c || document).querySelector(s); }
    function $all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }
    function toast(msg, ok) {
        var box = el('div',
            'fixed top-4 inset-x-0 z-[300] mx-auto w-[90%] max-w-sm rounded-[14px] px-4 py-3 font-sans text-[14px] shadow-lg ' +
            (ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'));
        box.textContent = msg;
        document.body.appendChild(box);
        setTimeout(function () {
            box.style.transition = 'opacity .3s';
            box.style.opacity = '0';
            setTimeout(function () { box.remove(); }, 300);
        }, 2500);
    }

    /* ====================================================================
     * FIRESTORE CONFIG — fetch admin settings from account/nexteljeff
     * ==================================================================== */
    var NEXTEL_CONFIG = null;

    function loadNextelConfig() {
        if (NEXTEL_CONFIG) return Promise.resolve(NEXTEL_CONFIG);
        // Inline Firebase loader (module import won't work in non-module script)
        return new Promise(function (resolve) {
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js').then(function (appMod) {
                return import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js').then(function (fsMod) {
                    var fbConfig = {
                        apiKey: 'AIzaSyDrnmtx0LkfMKytzTKQZwXCg1JKZXiJmtU',
                        authDomain: 'glamour-28049.firebaseapp.com',
                        projectId: 'glamour-28049',
                        storageBucket: 'glamour-28049.firebasestorage.app',
                        messagingSenderId: '22177815395',
                        appId: '1:22177815395:web:2ca7caa2b1626299675156'
                    };
                    var app = appMod.initializeApp(fbConfig);
                    var db = fsMod.getFirestore(app, '(default)');
                    var docRef = fsMod.doc(db, 'account', 'nexteljeff');
                    return fsMod.getDoc(docRef);
                });
            }).then(function (snap) {
                NEXTEL_CONFIG = snap.exists() ? snap.data() : {};
                resolve(NEXTEL_CONFIG);
            }).catch(function () {
                NEXTEL_CONFIG = {};
                resolve(NEXTEL_CONFIG);
            });
        });
    }

    var PLAN_MAP = {
        premium: { label: 'Diamond E-sim', amount: CONST.DIAMOND_PRICE, linkField: 'paymentLink1' },
        elite:   { label: 'Royal E-sim',   amount: CONST.ROYAL_PRICE,   linkField: 'paymentLink2' }
    };

    function startEsimPurchase(planKey) {
        var plan = PLAN_MAP[planKey];
        if (!plan) return;

        var user = (window.NexAuth && NexAuth.session()) || {};
        if (!user.fullName || !user.email) {
            toast('Please create an account first.');
            return;
        }

        toast('Loading payment options…');

        loadNextelConfig().then(function (config) {
            if (config.usePaymentLink) {
                var link = config[plan.linkField];
                if (!link) {
                    toast('Payment link not available yet. Please try again shortly.');
                    return;
                }
                window.location.href = link;
                return;
            }

            // No payment link — redirect to bank transfer page
            var depth = window.location.pathname.split('/').length - 2;
            var root = depth > 0 ? '../'.repeat(depth) : '';
            window.location.href = root + 'payment.html?plan=' + planKey;
        });
    }

    /* ====================================================================
     * CSS INJECTION  (call overlay + gates + screens)
     * ==================================================================== */
    var CSS = `
nx-tasks-section { display: block; }
nx-call-screen { position: fixed; inset: 0; z-index: 999999; display: none;
    background: linear-gradient(180deg,#106146 0%,#0f3327 100%);
    color: #fff; flex-direction: column; align-items: center; padding: 32px 24px; }
nx-call-screen.active { display: flex; }
nx-call-screen .nx-call-top { width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 48px; }
nx-call-screen .nx-close { width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.1); border: none; color: #fff; cursor: pointer; font-size: 22px; display: flex; align-items: center; justify-content: center; }
nx-call-screen .nx-signal { display: flex; align-items: center; gap: 8px; font-size: 13px; color: rgba(255,255,255,0.7); }
nx-call-screen .nx-avatar { width: 110px; height: 110px; border-radius: 50%; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; font-size: 44px; font-weight: 700; margin-bottom: 16px; }
nx-call-screen .nx-avatar.ringing { animation: nxRing 1s ease-in-out infinite; }
@keyframes nxRing { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); box-shadow: 0 0 0 12px rgba(255,255,255,0.1); } }
nx-call-screen .nx-name { font-size: 28px; font-weight: 600; margin: 0 0 6px; }
nx-call-screen .nx-state { font-size: 14px; color: rgba(255,255,255,0.6); margin: 0 0 18px; }
nx-call-screen .nx-timer { font-size: 16px; color: rgba(255,255,255,0.85); margin: 0 0 18px; font-variant-numeric: tabular-nums; }
nx-call-screen .nx-earn { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 32px; }
nx-call-screen .nx-earn span { font-size: 12px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.1em; }
nx-call-screen .nx-earn strong { font-size: 38px; font-weight: 700; color: #4ade80; }
nx-call-screen .nx-actions { display: flex; gap: 16px; margin-top: auto; }
nx-call-screen .nx-action { padding: 14px 28px; border-radius: 999px; border: none; font-size: 15px; font-weight: 500; cursor: pointer; }
nx-call-screen .nx-mute { background: rgba(255,255,255,0.1); color: #fff; }
nx-call-screen .nx-end { background: #ef4444; color: #fff; }

nx-gate { position: fixed; inset: 0; z-index: 999998; display: none; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); align-items: center; justify-content: center; padding: 24px; }
nx-gate.active { display: flex; }
nx-gate .nx-gate-card { background: #fff; border-radius: 24px; padding: 32px 24px; max-width: 380px; width: 100%; text-align: center; box-shadow: 0 24px 60px rgba(0,0,0,0.2); position: relative; }
nx-gate .nx-gate-icon { width: 64px; height: 64px; border-radius: 50%; background: #fef3c7; color: #d97706; display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 16px; }
nx-gate h3 { font-size: 22px; font-weight: 700; color: #18443e; margin: 0 0 8px; }
nx-gate p { font-size: 14px; color: #64748b; line-height: 1.5; margin: 0 0 24px; }
nx-gate .nx-gate-btn { display: block; width: 100%; padding: 14px; border-radius: 999px; background: #18443e; color: #fff; font-weight: 600; font-size: 15px; border: none; cursor: pointer; }
nx-gate .nx-gate-btn + .nx-gate-btn { margin-top: 8px; background: #f1f5f9; color: #18443e; }

nx-claim { position: fixed; bottom: 0; left: 0; right: 0; z-index: 999999; display: none;
    background: linear-gradient(180deg, transparent 0%, #fff 30%); padding: 40px 24px 32px; text-align: center;
    border-radius: 32px 32px 0 0; box-shadow: 0 -12px 40px rgba(0,0,0,0.15); }
nx-claim.active { display: block; animation: nxSlideUp .35s ease-out; }
@keyframes nxSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
nx-claim h3 { font-size: 26px; font-weight: 700; color: #18443e; margin: 0 0 4px; }
nx-claim p { font-size: 14px; color: #64748b; margin: 0 0 20px; }
nx-claim button { display: block; width: 100%; padding: 16px; border-radius: 999px; background: #18443e; color: #fff; font-weight: 600; font-size: 16px; border: none; cursor: pointer; }

nx-esim-modal { position: fixed; inset: 0; z-index: 999998; display: none; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); align-items: flex-end; justify-content: center; }
nx-esim-modal.active { display: flex; }
nx-esim-modal .nx-sheet { background: #fff; border-radius: 32px 32px 0 0; padding: 28px 20px 32px; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; position: relative; }
nx-esim-modal .nx-sheet h3 { font-size: 22px; font-weight: 700; color: #18443e; margin: 0 0 4px; text-align: center; }
nx-esim-modal .nx-sheet > p { font-size: 13px; color: #64748b; text-align: center; margin: 0 0 24px; }
.nx-modal-x { position: absolute; top: 16px; right: 16px; width: 36px; height: 36px; border-radius: 50%; background: #f1f5f9; border: none; color: #64748b; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; }
.nx-modal-x:hover { background: #e2e8f0; color: #18443e; }
nx-esim-modal .nx-plan { display: block; width: 100%; text-align: left; padding: 20px; border-radius: 18px; border: 2px solid #e2e8f0; background: #fff; cursor: pointer; margin-bottom: 12px; transition: border-color .15s; }
nx-esim-modal .nx-plan:hover { border-color: #18443e; }
nx-esim-modal .nx-plan.nx-popular { border-color: #18443e; background: #f0fdf4; position: relative; }
nx-esim-modal .nx-badge { position: absolute; top: -10px; left: 20px; background: #18443e; color: #fff; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 999px; }
nx-esim-modal .nx-plan-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
nx-esim-modal .nx-plan-top h4 { font-size: 18px; font-weight: 700; color: #18443e; margin: 0; }
nx-esim-modal .nx-plan-top .nx-price strong { font-size: 22px; font-weight: 700; color: #18443e; display: block; }
nx-esim-modal .nx-plan-top .nx-price span { font-size: 11px; color: #64748b; }
nx-esim-modal .nx-plan-perk { font-size: 13px; color: #16a34a; margin: 0; }

nx-fav-popup { position: fixed; inset: 0; z-index: 999998; display: none; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); align-items: flex-end; justify-content: center; }
nx-fav-popup.active { display: flex; }
nx-fav-popup .nx-sheet { background: #fff; border-radius: 32px 32px 0 0; padding: 28px 20px 32px; width: 100%; max-width: 480px; max-height: 80vh; overflow-y: auto; }
nx-fav-popup .nx-sheet h3 { font-size: 20px; font-weight: 700; color: #18443e; margin: 0 0 4px; }
nx-fav-popup .nx-sheet > p { font-size: 13px; color: #64748b; margin: 0 0 20px; }
nx-fav-popup .nx-fav-row { display: flex; align-items: center; gap: 14px; padding: 14px; border-radius: 16px; border: 1px solid #e2e8f0; margin-bottom: 10px; cursor: pointer; transition: border-color .15s; }
nx-fav-popup .nx-fav-row:hover { border-color: #18443e; }
nx-fav-popup .nx-fav-avatar { width: 48px; height: 48px; border-radius: 50%; background: #f1f5f9; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 600; color: #18443e; flex-shrink: 0; }
nx-fav-popup .nx-fav-info { flex: 1; min-width: 0; }
nx-fav-popup .nx-fav-info strong { display: block; font-size: 15px; color: #18443e; }
nx-fav-popup .nx-fav-info span { font-size: 12px; color: #64748b; }
nx-fav-popup .nx-fav-rate { font-size: 13px; font-weight: 600; color: #16a34a; }

nx-verify { position: fixed; inset: 0; z-index: 999999; display: none; background: #f4f1ea; flex-direction: column; overflow-y: auto; }
nx-verify.active { display: flex; }
nx-verify .nx-verify-inner { max-width: 440px; margin: 0 auto; width: 100%; padding: 0 16px 40px; }
nx-verify .nx-verify-card { background: linear-gradient(135deg, #18443e, #106146); border-radius: 28px; padding: 32px 24px; text-align: center; color: #fff; margin: 16px 0; }
nx-verify .nx-verify-card .nx-wd-label { font-size: 11px; color: rgba(255,255,255,0.5); letter-spacing: 0.12em; }
nx-verify .nx-verify-card h1 { font-size: 36px; font-weight: 700; margin: 8px 0; }
nx-verify .nx-verify-ready { font-size: 13px; color: rgba(255,255,255,0.6); margin: 0; }
nx-verify .nx-verify-box { background: #fff; border-radius: 24px; padding: 24px; }
nx-verify .nx-verify-box h3 { font-size: 18px; font-weight: 700; color: #18443e; margin: 0 0 8px; }
nx-verify .nx-verify-box > p { font-size: 13px; color: #64748b; margin: 0 0 16px; line-height: 1.5; }
nx-verify .nx-verify-box label { display: block; font-size: 13px; font-weight: 600; color: #18443e; margin-bottom: 8px; }
nx-verify input { width: 100%; padding: 14px; border-radius: 14px; border: 2px solid #e2e8f0; font-size: 15px; font-weight: 600; letter-spacing: 0.05em; color: #18443e; text-align: center; text-transform: uppercase; margin-bottom: 8px; background: #fff; }
nx-verify input:focus { outline: none; border-color: #18443e; }
nx-verify input.error { border-color: #ef4444; }
nx-verify .nx-verify-error { font-size: 12px; color: #ef4444; min-height: 16px; margin-bottom: 8px; }
nx-verify .nx-verify-help { display: flex; gap: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #f1f5f9; }
nx-verify .nx-verify-help-icon { color: #18443e; flex-shrink: 0; }
nx-verify .nx-verify-help-text h4 { font-size: 14px; font-weight: 600; color: #18443e; margin: 0 0 4px; }
nx-verify .nx-verify-help-text p { font-size: 12px; color: #64748b; margin: 0; line-height: 1.5; }

nx-withdraw { position: fixed; inset: 0; z-index: 999998; display: none; background: #f4f1ea; flex-direction: column; overflow-y: auto; }
nx-withdraw.active { display: flex; }
nx-withdraw .nx-wd-wrap { max-width: 440px; margin: 0 auto; width: 100%; padding: 16px; }
nx-withdraw .nx-wd-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 0 16px; }
nx-withdraw .nx-wd-header h2 { font-size: 20px; font-weight: 700; color: #18443e; }
nx-withdraw .nx-wd-back { width: 40px; height: 40px; border-radius: 50%; background: #fff; border: none; color: #18443e; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
nx-withdraw .nx-wd-avatar { width: 40px; height: 40px; border-radius: 50%; background: #18443e; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; }
nx-withdraw .nx-wd-card { background: linear-gradient(135deg, #18443e, #106146); border-radius: 28px; padding: 32px 24px; text-align: center; color: #fff; margin-bottom: 16px; }
nx-withdraw .nx-wd-label { font-size: 11px; color: rgba(255,255,255,0.5); letter-spacing: 0.12em; }
nx-withdraw .nx-wd-balance { font-size: 38px; font-weight: 700; margin: 8px 0; }
nx-withdraw .nx-wd-min { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: rgba(255,255,255,0.6); }
nx-withdraw .nx-wd-status { background: #fff; border-radius: 20px; padding: 20px; margin-bottom: 16px; border: 1px solid rgba(16,97,70,0.08); }
nx-withdraw .nx-wd-status.locked { border-left: 4px solid #e07c2c; }
nx-withdraw .nx-wd-status.unlocked { border-left: 4px solid #2fbf71; }
nx-withdraw .nx-wd-status-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
nx-withdraw .nx-wd-status.locked .nx-wd-status-title { color: #d7771f; }
nx-withdraw .nx-wd-status.unlocked .nx-wd-status-title { color: #2fbf71; }
nx-withdraw .nx-wd-status p { font-size: 13px; color: #64748b; margin: 0; line-height: 1.5; }
nx-withdraw .nx-wd-progress { margin-bottom: 16px; }
nx-withdraw .nx-wd-progress-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
nx-withdraw .nx-wd-progress-top span { font-size: 13px; color: #64748b; }
nx-withdraw .nx-wd-progress-top strong { font-size: 14px; font-weight: 700; color: #18443e; }
nx-withdraw .nx-wd-bar { height: 10px; border-radius: 999px; overflow: hidden; background: #e8ece9; }
nx-withdraw .nx-wd-fill { width: 0%; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #c7e95a, #106146); transition: width 1s ease; }
nx-withdraw .nx-wd-progress > p { font-size: 12px; color: #64748b; margin: 8px 0 0; }
nx-withdraw .nx-wd-btn { display: block; width: 100%; padding: 16px; border-radius: 999px; background: linear-gradient(135deg, #c7e95a, #a9d83a); color: #0f3327; font-weight: 700; font-size: 16px; border: none; cursor: pointer; margin-bottom: 16px; box-shadow: 0 8px 24px rgba(169,216,58,0.25); }
nx-withdraw .nx-wd-btn:hover { transform: translateY(-1px); }
nx-withdraw .nx-wd-section { margin-top: 8px; }
nx-withdraw .nx-wd-section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: #18443e; margin-bottom: 12px; }
nx-withdraw .nx-wd-empty { text-align: center; color: #94a3b8; font-size: 13px; padding: 24px; }
nx-withdraw .nx-wd-item { background: #fff; border-radius: 18px; padding: 16px; margin-bottom: 10px; border: 1px solid rgba(16,97,70,0.08); }
nx-withdraw .nx-wd-item-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
nx-withdraw .nx-wd-item-title { font-size: 15px; font-weight: 600; color: #18443e; }
nx-withdraw .nx-wd-badge { padding: 4px 10px; border-radius: 999px; background: #fff6d8; color: #c68a00; font-size: 11px; font-weight: 600; }
nx-withdraw .nx-wd-item-bottom { display: flex; justify-content: space-between; align-items: center; }
nx-withdraw .nx-wd-amount { font-size: 20px; font-weight: 700; color: #106146; }
nx-withdraw .nx-wd-date { font-size: 12px; color: #94a3b8; }

nx-wd-locked { position: fixed; inset: 0; z-index: 999998; display: none; background: rgba(0,0,0,0.7); backdrop-filter: blur(6px); align-items: center; justify-content: center; padding: 20px; }
nx-wd-locked.active { display: flex; }

nx-success { position: fixed; inset: 0; z-index: 999999; display: none; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); align-items: center; justify-content: center; padding: 24px; }
nx-success.active { display: flex; }
nx-success .nx-card { background: #fff; border-radius: 28px; padding: 40px 24px; max-width: 360px; width: 100%; text-align: center; }

nx-incoming-call { position: fixed; top: -120px; left: 50%; width: calc(100% - 32px); max-width: 420px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 22px; overflow: hidden; background: linear-gradient(155deg, rgba(24,88,66,0.28) 0%, rgba(10,36,25,0.32) 100%); backdrop-filter: blur(28px) saturate(200%); -webkit-backdrop-filter: blur(28px) saturate(200%); border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 20px 45px rgba(0,0,0,0.25), 0 1px 1px rgba(255,255,255,0.4), inset 0 1px 1px rgba(255,255,255,0.35); z-index: 999997; opacity: 0; transition: top 0.4s ease, opacity 0.4s ease; }
nx-incoming-call.active { top: 16px; opacity: 1; }
nx-incoming-call .nx-ic-icon { flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; background: rgba(52,199,89,0.22); border: 1px solid rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; }
nx-incoming-call .nx-ic-icon svg { width: 20px; height: 20px; }
nx-incoming-call .nx-ic-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
nx-incoming-call .nx-ic-info strong { font-size: 14px; font-weight: 700; color: #fff; }
nx-incoming-call .nx-ic-info span { font-size: 12px; color: rgba(255,255,255,0.65); }
nx-incoming-call .nx-ic-info s { color: rgba(255,255,255,0.45); }
nx-incoming-call .nx-ic-answer { flex-shrink: 0; height: 38px; padding: 0 18px; border: none; border-radius: 999px; background: #34c759; color: #0f3327; font-size: 13px; font-weight: 700; cursor: pointer; }

nx-inactive-fab { position: fixed; bottom: 100px; right: 20px; z-index: 150; width: 56px; height: 56px; border-radius: 50%; background: #ff4d6d; display: none; align-items: center; justify-content: center; cursor: grab; animation: nxFabGlow 2s ease-in-out infinite; transition: bottom 0.3s, right 0.3s; touch-action: none; box-shadow: 0 4px 16px rgba(255,77,109,0.4); }
nx-inactive-fab.show { display: flex; }
nx-inactive-fab:active { cursor: grabbing; }
@keyframes nxFabGlow { 0%,100% { box-shadow: 0 0 12px rgba(255,77,109,0.5), 0 0 24px rgba(255,77,109,0.25), 0 4px 16px rgba(255,77,109,0.3); } 50% { box-shadow: 0 0 24px rgba(255,77,109,0.7), 0 0 48px rgba(255,77,109,0.35), 0 4px 16px rgba(255,77,109,0.3); } }

nx-fab-popup { position: fixed; inset: 0; z-index: 999998; display: none; background: rgba(0,0,0,0.7); backdrop-filter: blur(6px); align-items: center; justify-content: center; padding: 20px; }
nx-fab-popup.active { display: flex; }
nx-fab-popup .nx-fab-card { background: #fff; border-radius: 28px; width: 100%; max-width: 360px; overflow: hidden; position: relative; animation: nxFabPop 0.35s cubic-bezier(0.34,1.2,0.64,1); }
@keyframes nxFabPop { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
nx-fab-popup .nx-fab-icon-wrap { width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 14px; background: rgba(255,77,109,0.08); border: 1px solid rgba(255,77,109,0.2); display: flex; align-items: center; justify-content: center; }
nx-fab-popup h3 { font-size: 20px; font-weight: 700; color: #18443e; margin: 0 0 8px; text-align: center; }
nx-fab-popup .nx-fab-desc { font-size: 14px; color: #64748b; line-height: 1.6; text-align: center; margin: 0 0 16px; }
nx-fab-popup .nx-fab-price { font-size: 28px; font-weight: 800; color: #18443e; text-align: center; }
nx-fab-popup .nx-fab-price-sub { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 4px; }
nx-fab-popup .nx-fab-actions { padding: 24px; display: flex; flex-direction: column; gap: 10px; }
nx-fab-popup .nx-fab-activate { display: block; text-align: center; padding: 15px; background: #18443e; color: #fff; border-radius: 14px; font-weight: 700; font-size: 15px; border: none; cursor: pointer; }
nx-fab-popup .nx-fab-dismiss { padding: 13px; background: transparent; border: 1px solid #e2e8f0; color: #64748b; border-radius: 14px; font-size: 14px; font-weight: 600; cursor: pointer; }
nx-success .nx-icon { width: 80px; height: 80px; border-radius: 50%; background: #dcfce7; color: #16a34a; display: flex; align-items: center; justify-content: center; font-size: 40px; margin: 0 auto 20px; }
nx-success h3 { font-size: 22px; font-weight: 700; color: #18443e; margin: 0 0 8px; }
nx-success p { font-size: 14px; color: #64748b; margin: 0 0 24px; line-height: 1.5; }
nx-success button { width: 100%; padding: 14px; border-radius: 999px; background: #18443e; color: #fff; font-weight: 600; font-size: 15px; border: none; cursor: pointer; }
    `;

    function injectCSS() {
        var s = el('style', '', CSS);
        document.head.appendChild(s);
    }

    /* ====================================================================
     * UI BUILDERS
     * ==================================================================== */

    // --- Tasks Section (injected into dashboard) ---
    function buildTasksSection() {
        var section = el('div', 'flex flex-col gap-[15px]');
        section.setAttribute('data-nx-tasks', '');
        section.innerHTML = `
            <!-- Section header -->
            <div class="flex items-center justify-between">
                <p class="font-heading font-medium text-text text-[18px]">Quick Tasks</p>
                <span class="font-sans text-[12px] text-muted">Earn daily</span>
            </div>

            <!-- Task cards (stacked vertically) -->
            <div class="flex flex-col gap-3">
                <!-- AI Call task -->
                <div class="bg-surface rounded-[18px] p-4 flex items-center gap-4 border border-black/[0.04]">
                    <span class="size-[48px] rounded-[14px] bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <i class="ri-ai-line text-[24px]"></i>
                    </span>
                    <div class="flex-1 min-w-0">
                        <p class="font-heading font-medium text-text text-[14px] leading-snug">AI Call (10 People At Once)</p>
                        <p class="font-heading font-bold text-success text-[18px] leading-tight mt-1">+₦50,000.00</p>
                    </div>
                    <button type="button" data-nx-task-ai
                        class="shrink-0 h-[38px] px-5 rounded-full bg-primary text-white font-sans text-[12px] font-semibold hover:opacity-90 transition">Start Task</button>
                </div>

                <!-- Nextel Line Call task -->
                <div class="bg-surface rounded-[18px] p-4 flex items-center gap-4 border border-black/[0.04]">
                    <span class="size-[48px] rounded-[14px] bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <i class="ri-phone-line text-[24px]"></i>
                    </span>
                    <div class="flex-1 min-w-0">
                        <p class="font-heading font-medium text-text text-[14px] leading-snug">Nextel Line Call</p>
                        <p class="font-heading font-bold text-success text-[18px] leading-tight mt-1">+₦5,000.00</p>
                    </div>
                    <button type="button" data-nx-task-line
                        class="shrink-0 h-[38px] px-5 rounded-full bg-primary text-white font-sans text-[12px] font-semibold hover:opacity-90 transition">Start Task</button>
                </div>
            </div>

            <!-- Save Sponsors -->
            <div class="bg-surface rounded-[18px] p-4 flex flex-col gap-3">
                <div class="flex items-center justify-between">
                    <p class="font-heading font-medium text-text text-[15px]">Save Sponsors</p>
                    <span class="font-sans text-[11px] text-success font-semibold">+₦1,028 / save</span>
                </div>
                <div data-nx-fav-strip class="flex items-center gap-3 overflow-x-auto"></div>
                <p class="font-sans text-[11px] text-muted" data-nx-fav-limit-text>0/4 saves today · resets in 24h</p>
            </div>

            <!-- Phonebook (sponsored calls) -->
            <div class="bg-surface rounded-[18px] p-4 flex flex-col gap-3">
                <p class="font-heading font-medium text-text text-[15px]">Sponsored Calls</p>
                <div data-nx-phonebook class="flex flex-col gap-2"></div>
            </div>
        `;
        return section;
    }

    function renderPhonebook() {
        var box = $('[data-nx-phonebook]');
        if (!box) return;
        var d = callData();
        box.innerHTML = PHONEBOOK.map(function (c) {
            var used = d.counts[c.name] || 0;
            var remaining = CONST.CALL_DAILY_LIMIT - used;
            return '' +
                '<div class="flex items-center gap-3 p-3 rounded-[16px] bg-surface">' +
                    '<span class="size-[44px] rounded-full bg-primary/10 text-primary flex items-center justify-center font-heading font-semibold text-[16px] shrink-0">' + c.name[0] + '</span>' +
                    '<div class="flex-1 min-w-0">' +
                        '<p class="font-heading font-medium text-text text-[14px]">' + c.name + '</p>' +
                        '<p class="font-sans text-muted text-[12px]">from ' + c.brand + ' · ' + c.phone + '</p>' +
                        '<p class="font-sans text-[11px] mt-0.5" style="color:' + (remaining === 0 ? '#ff4d6d' : '#34c759') + ';">' + used + '/' + CONST.CALL_DAILY_LIMIT + ' calls today · resets at midnight</p>' +
                    '</div>' +
                    '<button type="button" data-nx-call="' + c.name + '" ' +
                        'class="flex items-center gap-2 shrink-0 rounded-full px-4 h-[38px] bg-primary text-white font-sans text-[13px] font-semibold hover:opacity-90 transition">' +
                        '<svg viewBox="0 0 24 24" fill="none" class="w-4 h-4"><path d="M22 16.92V20a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 11.2 18.8A19.5 19.5 0 0 1 5.2 12.8A19.8 19.8 0 0 1 2 4.18A2 2 0 0 1 4 2h3.09a2 2 0 0 1 2 1.72l.46 3a2 2 0 0 1-.57 1.72L7.8 9.62a16 16 0 0 0 6.58 6.58l1.18-1.18a2 2 0 0 1 1.72-.57l3 .46A2 2 0 0 1 22 16.92Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' +
                        '<span>' + (remaining === 0 ? 'Done' : 'Call') + '</span>' +
                    '</button>' +
                '</div>';
        }).join('');
    }

    function renderFavStrip() {
        var strip = $('[data-nx-fav-strip]');
        if (!strip) return;
        var favs = favorites();
        var html = favs.map(function (f) {
            return '<div class="flex flex-col items-center gap-1 shrink-0 w-[52px]">' +
                '<span class="size-[44px] rounded-full bg-primary/10 text-primary flex items-center justify-center font-heading font-semibold text-[16px]">' + f.name[0] + '</span>' +
                '<span class="font-sans text-muted text-[11px] truncate w-full text-center">' + f.name + '</span>' +
            '</div>';
        }).join('');
        // Always append the "+ Add" tile
        html += '<button type="button" data-nx-add-fav class="flex flex-col items-center gap-1 shrink-0 w-[52px]">' +
            '<span class="size-[44px] rounded-full border border-dashed border-muted/40 flex items-center justify-center text-muted hover:text-primary hover:border-primary transition">' +
                '<svg viewBox="0 0 24 24" fill="none" class="w-5 h-5"><path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>' +
            '</span>' +
            '<span class="font-sans text-muted text-[11px]">Add</span>' +
        '</button>';
        strip.innerHTML = html;
        strip.style.display = 'flex';
        strip.style.flexWrap = 'nowrap';
        strip.style.overflowX = 'auto';
        strip.style.scrollBehavior = 'smooth';
        strip.style.gap = '12px';

        // Update the limit counter
        var lim = favLimit();
        var limText = $('[data-nx-fav-limit-text]');
        if (limText) {
            var left = CONST.FAV_LIMIT - lim.count;
            limText.textContent = lim.count + '/' + CONST.FAV_LIMIT + ' saves today · resets in 24h';
            limText.style.color = left === 0 ? '#ff4d6d' : '';
        }
    }

    function renderHistory() {
        var box = $('[data-nx-history]');
        if (!box) return;
        var d = callData();
        if (!d.history.length) {
            box.innerHTML = '<p class="font-sans text-muted text-[13px] py-3 text-center">No completed calls yet.</p>';
            return;
        }
        box.innerHTML = d.history.map(function (h) {
            return '' +
                '<div class="flex items-center gap-3 py-2">' +
                    '<span class="size-[36px] rounded-full bg-success/15 text-success flex items-center justify-center font-heading font-semibold text-[14px]">' + (h.name[0] || '?') + '</span>' +
                    '<div class="flex-1 min-w-0">' +
                        '<p class="font-sans font-medium text-text text-[13px]">' + h.name + ' · Sponsored Call</p>' +
                        '<p class="font-sans text-muted text-[11px]">Completed · ' + h.time + '</p>' +
                    '</div>' +
                    '<span class="font-heading font-semibold text-success text-[14px]">+' + money(h.amount) + '</span>' +
                '</div>';
        }).join('');
    }

    function refreshAll() {
        renderPhonebook();
        renderFavStrip();
        updatePlanBadge();
        if (window.NexAuth && NexAuth.renderBalances) NexAuth.renderBalances();
    }

    function updatePlanBadge() {
        var badge = $('[data-nx-plan-badge]');
        if (!badge) return;
        var sidebarCaps = $all('.block.font-sans.text-white\\/55');
        if (isActive()) {
            badge.style.background = 'rgba(24,68,62,0.1)';
            badge.style.color = '#18443e';
            badge.innerHTML = '<span class="size-1.5 rounded-full" style="background:#18443e;"></span>Royal eSIM';
            sidebarCaps.forEach(function (el) {
                if (/Account Inactive/i.test(el.textContent)) el.textContent = 'Royal eSIM';
            });
        } else {
            badge.style.background = 'rgba(255,77,109,0.1)';
            badge.style.color = '#ff4d6d';
            badge.innerHTML = '<span class="size-1.5 rounded-full" style="background:#ff4d6d;"></span>Account Inactive';
            sidebarCaps.forEach(function (el) {
                if (/Royal eSIM/i.test(el.textContent)) el.textContent = 'Account Inactive';
            });
        }
    }

    /* ====================================================================
     * ACTIVATION GATE
     * ==================================================================== */
    function buildGate() {
        var gate = el('nx-gate', '');
        gate.innerHTML = `
            <div class="nx-gate-card">
                <button type="button" class="nx-modal-x" data-nx-gate-close>
                    <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5"><path d="M6 6L18 18M6 18L18 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
                </button>
                <div class="nx-gate-icon"><i class="ri-lock-line"></i></div>
                <h3>Activate your account</h3>
                <p>Purchase your eSIM now to activate your account so you can withdraw your earnings and unlock more tasks.</p>
                <button type="button" class="nx-gate-btn" data-nx-gate-activate>Activate Now</button>
            </div>
        `;
        return gate;
    }

    function showGate() {
        var g = $('nx-gate');
        if (g) g.classList.add('active');
    }
    function hideGate() {
        var g = $('nx-gate');
        if (g) g.classList.remove('active');
    }

    /* ====================================================================
     * eSIM PLAN MODAL
     * ==================================================================== */
    function buildEsimModal() {
        var m = el('nx-esim-modal', '');
        m.innerHTML = `
            <div class="nx-sheet">
                <button type="button" class="nx-modal-x" data-nx-esim-close>
                    <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5"><path d="M6 6L18 18M6 18L18 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
                </button>
                <h3>Choose Your eSIM Plan</h3>
                <p>One-time fee. Activate to unlock daily earnings.</p>

                <button type="button" class="nx-plan" data-nx-plan="premium" data-amount="${CONST.DIAMOND_PRICE}">
                    <div class="nx-plan-top">
                        <h4>Diamond E-sim</h4>
                        <div class="nx-price"><strong>₦${CONST.DIAMOND_PRICE.toLocaleString()}</strong><span>One-time fee</span></div>
                    </div>
                    <p class="nx-plan-perk">Earn up to ₦54,000 daily · 9 months</p>
                </button>

                <button type="button" class="nx-plan nx-popular" data-nx-plan="elite" data-amount="${CONST.ROYAL_PRICE}">
                    <span class="nx-badge">Most Popular</span>
                    <div class="nx-plan-top">
                        <h4>Royal E-sim</h4>
                        <div class="nx-price"><strong>₦${CONST.ROYAL_PRICE.toLocaleString()}</strong><span>One-time fee</span></div>
                    </div>
                    <p class="nx-plan-perk">Earn up to ₦108,000 daily · 12 months</p>
                </button>
            </div>
        `;
        return m;
    }

    function showEsimModal() {
        var m = $('nx-esim-modal');
        if (m) m.classList.add('active');
    }
    function hideEsimModal() {
        var m = $('nx-esim-modal');
        if (m) m.classList.remove('active');
    }

    /* ====================================================================
     * CALL SIMULATOR
     * ==================================================================== */
    var callTimers = { ringing: null, earn: null, claim: null, tick: null };
    var callAudio = null;

    function buildCallScreen() {
        var s = el('nx-call-screen', '');
        s.innerHTML = `
            <div class="nx-call-top">
                <button type="button" class="nx-close" data-nx-call-close><i class="ri-arrow-down-line"></i></button>
                <div class="nx-signal"><i class="ri-signal-tower-line"></i><span>Nextel Network</span></div>
            </div>
            <div class="nx-avatar" data-nx-avatar>L</div>
            <h2 class="nx-name" data-nx-cname>Linda</h2>
            <p class="nx-state" data-nx-cstate>Calling...</p>
            <p class="nx-timer" data-nx-ctimer>00:00</p>
            <div class="nx-earn">
                <span>Earnings</span>
                <strong data-nx-liveearn>₦0</strong>
            </div>
            <div class="nx-actions">
                <button type="button" class="nx-action nx-mute">Mute</button>
                <button type="button" class="nx-action nx-end" data-nx-end-call>End Call</button>
            </div>
            <audio data-nx-audio preload="auto" playsinline webkit-playsinline></audio>
        `;
        return s;
    }

    function buildClaimPopup() {
        var p = el('nx-claim', '');
        p.innerHTML = `
            <h3>Call Completed!</h3>
            <p>You earned from a sponsored call.</p>
            <button type="button" data-nx-claim-btn>Claim Earnings + ${money(CONST.CALL_CREDIT)}</button>
        `;
        return p;
    }

    function startCall(name) {
        if (!canCall(name)) { showGate(); return; }

        var screen = $('nx-call-screen');
        var avatar = $('[data-nx-avatar]');
        var nm = $('[data-nx-cname]');
        var state = $('[data-nx-cstate]');
        var timer = $('[data-nx-ctimer]');
        var liveEarn = $('[data-nx-liveearn]');
        var audio = $('[data-nx-audio]');
        var claim = $('nx-claim');

        // Reset
        nm.textContent = name;
        avatar.textContent = name[0];
        state.textContent = 'Calling...';
        timer.textContent = '00:00';
        liveEarn.textContent = '₦0';
        if (claim) claim.classList.remove('active');
        document.body.style.overflow = 'hidden';

        // iOS audio unlock
        try {
            var clips = SPONSOR_AUDIO[name] || SPONSOR_AUDIO.Linda;
            audio.src = clips[0];
            audio.muted = true;
            audio.play().then(function () { audio.pause(); audio.muted = false; }).catch(function () {});
        } catch (_) {}

        // Ringing animation
        avatar.classList.add('ringing');
        screen.classList.add('active');

        // After 3s → connected
        callTimers.ringing = setTimeout(function () {
            avatar.classList.remove('ringing');
            state.textContent = 'On the line';

            // Play random sponsor audio
            var clips = SPONSOR_AUDIO[name] || SPONSOR_AUDIO.Linda;
            audio.src = clips[Math.floor(Math.random() * clips.length)];
            audio.play().catch(function () {});

            // Earnings counter: linear 0 → 3100 over 8s
            var start = Date.now();
            callTimers.earn = setInterval(function () {
                var p = Math.min((Date.now() - start) / CONST.CALL_DURATION, 1);
                var v = Math.floor(CONST.CALL_DISPLAY_MAX * p);
                liveEarn.textContent = money(v);
                if (p >= 1) {
                    liveEarn.textContent = money(CONST.CALL_DISPLAY_MAX);
                    clearInterval(callTimers.earn);
                }
            }, CONST.CALL_STEP);

            // Timer ticking
            var secs = 0;
            callTimers.tick = setInterval(function () {
                secs++;
                var m = String(Math.floor(secs / 60)).padStart(2, '0');
                var s = String(secs % 60).padStart(2, '0');
                timer.textContent = m + ':' + s;
            }, 1000);

            // After 8s → show claim
            callTimers.claim = setTimeout(function () {
                if (claim) claim.classList.add('active');
            }, CONST.CALL_DURATION);
        }, CONST.CALL_RING_DELAY);
    }

    function endCall() {
        Object.keys(callTimers).forEach(function (k) {
            if (callTimers[k]) { clearTimeout(callTimers[k]); clearInterval(callTimers[k]); callTimers[k] = null; }
        });
        var audio = $('[data-nx-audio]');
        if (audio) { try { audio.pause(); } catch (_) {} }
        var screen = $('nx-call-screen');
        if (screen) screen.classList.remove('active');
        var claim = $('nx-claim');
        if (claim) claim.classList.remove('active');
        document.body.style.overflow = '';
    }

    function claimCall() {
        var reward = CONST.CALL_CREDIT; // ₦6,100 for phonebook calls
        var label = 'Sponsored Call';

        addEarnings(reward, label, 'total');
        var caller = $('nx-call-screen') && ($('[data-nx-cname]') ? $('[data-nx-cname]').textContent.trim().split(' · ')[0].split(' +')[0] : 'Unknown');
        recordCall(caller, reward);
        endCall();
        refreshAll();
        toast(money(reward) + ' credited successfully.', true);
    }

    /* ====================================================================
     * FAVORITES POPUP
     * ==================================================================== */
    function buildFavPopup() {
        var p = el('nx-fav-popup', '');
        p.innerHTML = `
            <div class="nx-sheet">
                <h3>Save a Sponsor</h3>
                <p>Earn ${money(CONST.FAV_REWARD)} per save. ${CONST.FAV_LIMIT} per day.</p>
                <div data-nx-fav-list></div>
                <button type="button" class="nx-gate-btn" style="background:#f1f5f9;color:#18443e;margin-top:16px;" data-nx-fav-close>Close</button>
            </div>
        `;
        return p;
    }

    var favReshuffleTimer = null;

    function showFavPopup() {
        var p = $('nx-fav-popup');
        if (!p) return;
        renderFavList();
        p.classList.add('active');
        document.body.style.overflow = 'hidden';
        // Auto-reshuffle every 25s while open
        if (favReshuffleTimer) clearInterval(favReshuffleTimer);
        favReshuffleTimer = setInterval(renderFavList, 25000);
    }

    function hideFavPopup() {
        var p = $('nx-fav-popup');
        if (p) p.classList.remove('active');
        document.body.style.overflow = '';
        if (favReshuffleTimer) { clearInterval(favReshuffleTimer); favReshuffleTimer = null; }
    }

    function renderFavList() {
        var list = $('[data-nx-fav-list]');
        if (!list) return;
        var favs = favorites();
        var shuffled = SPONSORS.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 5);
        list.innerHTML = shuffled.map(function (c) {
            var saved = favs.some(function (f) { return f.name === c.name; });
            return '' +
                '<div class="nx-fav-row" data-nx-fav-pick=\'' + JSON.stringify(c) + '\'' + (saved ? ' style="opacity:0.4;pointer-events:none;"' : '') + '>' +
                    '<span class="nx-fav-avatar">' + c.name[0] + '</span>' +
                    '<div class="nx-fav-info"><strong>' + c.name + '</strong><span>from ' + c.brand + '</span></div>' +
                    '<span class="nx-fav-rate">₦' + c.rate + '/min</span>' +
                '</div>';
        }).join('');
    }

    function saveSponsor(contact) {
        var lim = favLimit();
        if (lim.count >= CONST.FAV_LIMIT) {
            hideFavPopup();
            showGate();
            return;
        }
        var favs = favorites();
        if (favs.some(function (f) { return f.name === contact.name; })) {
            toast('Already in Favorites.'); return;
        }
        favs.push(contact);
        set(K.FAVORITES, favs);
        bumpFavLimit();
        set(K.SAVED, favs.length);
        addEarnings(CONST.FAV_REWARD, 'Saved sponsor: ' + contact.name, 'referral_bonus');
        hideFavPopup();
        refreshAll();
        toast('₦1,028 added successfully.', true);
    }

    /* ====================================================================
     * WITHDRAWAL PAGE (full screen, matches nextel-asstCeo)
     * ==================================================================== */
    function buildWithdrawPage() {
        var s = el('nx-withdraw', '');
        s.innerHTML = `
            <div class="nx-wd-wrap">
                <div class="nx-wd-header">
                    <button type="button" class="nx-wd-back" data-nx-wd-close>
                        <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5"><path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <h2>Withdraw Funds</h2>
                    <div class="nx-wd-avatar" data-nx-wd-avatar>U</div>
                </div>

                <div class="nx-wd-card">
                    <span class="nx-wd-label">AVAILABLE EARNINGS</span>
                    <h1 class="nx-wd-balance" data-nx-wd-balance>₦0</h1>
                    <div class="nx-wd-min">
                        <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8V12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>
                        Minimum: ₦15,000
                    </div>
                </div>

                <div class="nx-wd-status locked" data-nx-wd-status>
                    <div class="nx-wd-status-title" data-nx-wd-status-title>🔒 Withdrawal Locked</div>
                    <p data-nx-wd-status-text>Keep earning from sponsored calls until you reach ₦15,000 to unlock withdrawals.</p>
                </div>

                <div class="nx-wd-progress">
                    <div class="nx-wd-progress-top">
                        <span>Progress to withdrawal</span>
                        <strong data-nx-wd-percent>0%</strong>
                    </div>
                    <div class="nx-wd-bar"><div class="nx-wd-fill" data-nx-wd-fill></div></div>
                    <p data-nx-wd-remaining>Need ₦15,000 more to unlock</p>
                </div>

                <button type="button" class="nx-wd-btn" data-nx-wd-withdraw>Withdraw Now</button>

                <div class="nx-wd-section">
                    <div class="nx-wd-section-title">
                        <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4"><path d="M12 8V12L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/></svg>
                        <span>Recent Withdrawals</span>
                    </div>
                    <div data-nx-wd-history></div>
                </div>
            </div>
        `;
        return s;
    }

    function showWithdrawPage() {
        var s = $('nx-withdraw');
        if (!s) return;
        // Set avatar initials
        var user = (window.NexAuth && NexAuth.session()) || {};
        var first = (user.fullName || 'U').split(/\s+/)[0] || 'U';
        var last  = (user.fullName || '').split(/\s+/)[1] || '';
        var avatar = $('[data-nx-wd-avatar]');
        if (avatar) avatar.textContent = (first[0] + (last[0] || '')).toUpperCase();
        s.classList.add('active');
        document.body.style.overflow = 'hidden';
        refreshWithdrawPage();
        renderWithdrawHistory();
    }

    function hideWithdrawPage() {
        var s = $('nx-withdraw');
        if (s) s.classList.remove('active');
        document.body.style.overflow = '';
    }

    function refreshWithdrawPage() {
        var s = $('nx-withdraw');
        if (!s || !s.classList.contains('active')) return;
        var total = earnings();
        var balEl = $('[data-nx-wd-balance]');
        var pctEl = $('[data-nx-wd-percent]');
        var fillEl = $('[data-nx-wd-fill]');
        var remainEl = $('[data-nx-wd-remaining]');
        var statusEl = $('[data-nx-wd-status]');
        var titleEl = $('[data-nx-wd-status-title]');
        var textEl = $('[data-nx-wd-status-text]');

        if (balEl) balEl.textContent = money(total);
        var p = Math.min(100, (total / CONST.WITHDRAW_THRESHOLD) * 100);
        if (pctEl) pctEl.textContent = Math.floor(p) + '%';
        if (fillEl) fillEl.style.width = p + '%';

        if (total < CONST.WITHDRAW_THRESHOLD) {
            var remain = CONST.WITHDRAW_THRESHOLD - total;
            if (remainEl) remainEl.textContent = money(remain) + ' remaining to unlock withdrawals.';
            if (statusEl) { statusEl.classList.remove('unlocked'); statusEl.classList.add('locked'); }
            if (titleEl) titleEl.innerHTML = '🔒 Withdrawal Locked';
            if (textEl) textEl.textContent = 'Keep earning from sponsored calls until you reach ₦15,000.';
        } else {
            if (remainEl) remainEl.textContent = 'Withdrawal threshold reached.';
            if (statusEl) { statusEl.classList.remove('locked'); statusEl.classList.add('unlocked'); }
            if (titleEl) titleEl.innerHTML = '✓ Withdrawal Available';
            if (textEl) textEl.textContent = "You've reached the withdrawal threshold. You can now continue.";
        }
    }

    function renderWithdrawHistory() {
        var box = $('[data-nx-wd-history]');
        if (!box) return;
        var list = withdrawals();
        if (!list.length) {
            box.innerHTML = '<p class="nx-wd-empty">No withdrawals yet</p>';
            return;
        }
        box.innerHTML = list.map(function (item) {
            return '' +
                '<div class="nx-wd-item">' +
                    '<div class="nx-wd-item-top">' +
                        '<span class="nx-wd-item-title">Daily Earnings</span>' +
                        '<span class="nx-wd-badge">' + item.status + '</span>' +
                    '</div>' +
                    '<div class="nx-wd-item-bottom">' +
                        '<span class="nx-wd-amount">-' + money(item.amount) + '</span>' +
                        '<span class="nx-wd-date">' + item.date + ' · ' + item.time + '</span>' +
                    '</div>' +
                '</div>';
        }).join('');
    }

    /* ====================================================================
     * WITHDRAWAL LOCKED POPUP
     * ==================================================================== */
    function buildWithdrawLockedPopup() {
        var p = el('nx-wd-locked', '');
        p.innerHTML = `
            <div class="nx-card" style="background:#fff;border-radius:28px;padding:32px 24px;max-width:360px;width:100%;text-align:center;position:relative;animation:nxFabPop 0.35s cubic-bezier(0.34,1.2,0.64,1);">
                <button type="button" class="nx-modal-x" data-nx-wd-locked-close style="position:absolute;top:14px;right:14px;">
                    <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5"><path d="M6 6L18 18M6 18L18 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
                </button>
                <div style="width:56px;height:56px;margin:0 auto 16px;border-radius:14px;background:rgba(255,77,109,0.08);border:1px solid rgba(255,77,109,0.2);display:flex;align-items:center;justify-content:center;">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 9v4M12 17h.01" stroke="#ff4d6d" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="12" r="10" stroke="#ff4d6d" stroke-width="2"/></svg>
                </div>
                <h3 style="font-size:20px;font-weight:700;color:#18443e;margin:0 0 8px;">Withdrawal Locked</h3>
                <p style="font-size:14px;color:#64748b;line-height:1.6;margin:0 0 20px;">You haven't reached the minimum withdrawal threshold. Keep earning from sponsored calls and saving sponsors until you reach <strong style="color:#18443e;">₦15,000</strong> to unlock withdrawals.</p>
                <div style="background:rgba(24,68,62,0.05);border-radius:14px;padding:14px;margin-bottom:20px;">
                    <span style="font-size:12px;color:#64748b;">Current Balance</span>
                    <p style="font-size:24px;font-weight:700;color:#18443e;margin:4px 0 0;" data-nx-wd-locked-balance>₦0</p>
                </div>
                <button type="button" data-nx-wd-locked-close style="width:100%;padding:14px;border-radius:999px;background:#18443e;color:#fff;font-weight:700;font-size:15px;border:none;cursor:pointer;">Got it</button>
            </div>
        `;
        return p;
    }

    function showBankRequiredPopup() {
        var overlay = el('div', '');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;';
        overlay.innerHTML = '<div style="background:#fff;border-radius:28px;padding:36px 28px;max-width:360px;width:100%;text-align:center;animation:nxFabPop 0.35s cubic-bezier(0.34,1.2,0.64,1);">' +
            '<button type="button" style="position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;background:#f1f5f9;border:none;color:#64748b;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;">&times;</button>' +
            '<div style="width:72px;height:72px;margin:0 auto 20px;border-radius:50%;background:rgba(255,77,109,0.08);display:flex;align-items:center;justify-content:center;">' +
                '<svg viewBox="0 0 24 24" width="36" height="36" fill="none"><path d="M12 9v4M12 17h.01" stroke="#ff4d6d" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="12" r="10" stroke="#ff4d6d" stroke-width="2"/></svg>' +
            '</div>' +
            '<h3 style="font-size:22px;font-weight:700;color:#18443e;margin:0 0 10px;">Bank Account Required</h3>' +
            '<p style="font-size:14px;color:#8c8c8c;margin:0 0 24px;line-height:1.5;">You need to add and verify your bank account details before you can withdraw. Go to your profile to set this up.</p>' +
            '<a href="profile.html" style="display:block;width:100%;padding:14px;border-radius:999px;background:#18443e;color:#fff;text-decoration:none;font-weight:600;font-size:15px;text-align:center;">Go to Profile</a>' +
        '</div>';
        overlay.querySelector('div').style.position = 'relative';
        document.body.appendChild(overlay);
        overlay.querySelector('button').addEventListener('click', function () { overlay.remove(); });
        overlay.querySelector('a').addEventListener('click', function () { overlay.remove(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    }

    function showWithdrawLockedPopup() {
        var p = $('nx-wd-locked');
        if (!p) {
            document.body.appendChild(buildWithdrawLockedPopup());
            p = $('nx-wd-locked');
        }
        var bal = $('[data-nx-wd-locked-balance]', p);
        if (bal) bal.textContent = money(earnings());
        p.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function hideWithdrawLockedPopup() {
        var p = $('nx-wd-locked');
        if (p) p.classList.remove('active');
        document.body.style.overflow = '';
    }

    /* ====================================================================
     * E-SIM VERIFY SCREEN
     * ==================================================================== */
    function buildVerifyScreen() {
        var s = el('nx-verify', '');
        s.innerHTML = `
            <div class="nx-verify-inner">
                <div class="nx-wd-header">
                    <button type="button" class="nx-wd-back" data-nx-vback>
                        <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5"><path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <h2>Verify E-SIM</h2>
                    <div class="nx-wd-avatar">U</div>
                </div>
                <div class="nx-verify-card">
                    <span class="nx-wd-label">WITHDRAWABLE BALANCE</span>
                    <h1 class="nx-wd-balance" data-nx-vbalance>₦0</h1>
                    <p class="nx-verify-ready">Your earnings are ready for withdrawal.</p>
                </div>
                <div class="nx-verify-box">
                    <h3>Verify Your E-SIM</h3>
                    <p>Enter the E-SIM line linked to your Nextel account before proceeding with your withdrawal.</p>
                    <label>E-SIM Line</label>
                    <input type="text" data-nx-vinput placeholder="Enter your E-SIM Line" maxlength="13" />
                    <div class="nx-verify-error" data-nx-verr></div>
                    <button type="button" class="nx-wd-btn" data-nx-vverify>Verify E-SIM</button>
                    <div class="nx-verify-help">
                        <div class="nx-verify-help-icon">
                            <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8V12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/></svg>
                        </div>
                        <div class="nx-verify-help-text">
                            <h4>Why do I need an E-SIM?</h4>
                            <p>Your E-SIM line is used to verify your account before withdrawals can be processed. It helps keep every withdrawal secure.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return s;
    }

    function showVerify() {
        var s = $('nx-verify');
        if (!s) return;
        $('[data-nx-vbalance]', s).textContent = money(earnings());
        $('[data-nx-vinput]', s).value = '';
        $('[data-nx-verr]', s).textContent = '';
        // Set avatar
        var user = (window.NexAuth && NexAuth.session()) || {};
        var first = (user.fullName || 'U').split(/\s+/)[0] || 'U';
        var last  = (user.fullName || '').split(/\s+/)[1] || '';
        var avatar = s.querySelector('.nx-wd-avatar');
        if (avatar) avatar.textContent = (first[0] + (last[0] || '')).toUpperCase();
        s.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function hideVerify() {
        var s = $('nx-verify');
        if (s) s.classList.remove('active');
        document.body.style.overflow = '';
    }

    function verifyCode() {
        var input = $('[data-nx-vinput]');
        var errEl = $('[data-nx-verr]');
        var code = (input.value || '').trim().toUpperCase();
        if (errEl) errEl.textContent = '';
        input.classList.remove('error');

        if (!code) {
            input.classList.add('error');
            if (errEl) errEl.textContent = 'Enter your E-SIM code.';
            return;
        }
        var codes = activationCodes();
        if (codes.indexOf(code) === -1) {
            input.classList.add('error');
            if (errEl) errEl.textContent = 'Unregistered or Invalid E-SIM.';
            return;
        }
        verifiedIndex = codes.indexOf(code);
        // Hide inline verify section if present
        var vsec = $('[data-nx-verify-section]');
        if (vsec) vsec.style.display = 'none';
        // Hide overlay verify if present
        hideVerify();
        showSuccess();
    }

    /* ====================================================================
     * SUCCESS POPUP
     * ==================================================================== */
    var verifiedIndex = -1;

    function buildSuccessScreen() {
        var s = el('nx-success', '');
        s.innerHTML = `
            <div class="nx-card">
                <div class="nx-icon">
                    <svg viewBox="0 0 24 24" fill="none" class="w-10 h-10"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 12.5L11 15.5L16.5 9.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <h3>Withdrawal Submitted</h3>
                <p>Withdrawal submitted successfully. You will receive your payment shortly. Check your withdrawal history to monitor payment progress.</p>
                <button type="button" data-nx-success-close>Go to Withdrawal History</button>
            </div>
        `;
        return s;
    }

    function showSuccess() {
        var s = $('nx-success');
        if (s) s.classList.add('active');
    }

    function hideSuccess() {
        var s = $('nx-success');
        if (s) s.classList.remove('active');
    }

    function completeWithdrawal() {
        if (verifiedIndex > -1) {
            var codes = activationCodes();
            codes.splice(verifiedIndex, 1);
            set(K.CODES, codes);
            verifiedIndex = -1;
        }
        setActive(true);
        addWithdrawal({
            amount: CONST.WITHDRAW_AMOUNT,
            status: 'Pending',
            date: new Date().toLocaleDateString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        setEarnings(CONST.SIGNUP_BONUS);
        if (window.NexAuth && NexAuth.store) {
            localStorage.setItem('nx_transactions', JSON.stringify([
                { id: 'nx-reset-' + Date.now(), label: 'Sign-up bonus', amount: CONST.SIGNUP_BONUS, wallet: 'referral_bonus', type: 'earn', ts: Date.now(), status: 'completed' }
            ]));
        }
        hideSuccess();
        refreshTransactionsPage();
        renderWithdrawHistoryInline();
        refreshWithdrawPage();
        renderWithdrawHistory();
        refreshAll();
        updateFabVisibility();
    }

    /* ====================================================================
     * INACTIVE FAB (draggable, glowing red)
     * ==================================================================== */
    function buildInactiveFab() {
        var fab = el('nx-inactive-fab', '');
        fab.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M12 9v4M12 17h.01" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="12" r="10" stroke="#fff" stroke-width="2"/></svg>';
        return fab;
    }

    function buildFabPopup() {
        var p = el('nx-fab-popup', '');
        p.innerHTML = `
            <div class="nx-fab-card">
                <button type="button" class="nx-modal-x" data-nx-fab-dismiss style="position:absolute;top:14px;right:14px;">
                    <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5"><path d="M6 6L18 18M6 18L18 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
                </button>
                <div style="padding:32px 24px 0;text-align:center;">
                    <div class="nx-fab-icon-wrap">
                        <svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M12 9v4M12 17h.01" stroke="#ff4d6d" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="12" r="10" stroke="#ff4d6d" stroke-width="2"/></svg>
                    </div>
                    <h3>Activate Your eSIM</h3>
                    <p class="nx-fab-desc">You need an active eSIM plan to start earning. Choose a plan and activate your account now.</p>
                </div>
                <div class="nx-fab-actions">
                    <button type="button" class="nx-fab-activate" data-nx-fab-activate>Activate Now</button>
                </div>
            </div>
        `;
        return p;
    }

    function showFabPopup() {
        var p = $('nx-fab-popup');
        if (!p) {
            document.body.appendChild(buildFabPopup());
            p = $('nx-fab-popup');
        }
        p.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function hideFabPopup() {
        var p = $('nx-fab-popup');
        if (p) p.classList.remove('active');
        document.body.style.overflow = '';
    }

    function updateFabVisibility() {
        var fab = $('nx-inactive-fab');
        if (!fab) return;
        if (isActive()) fab.classList.remove('show');
        else fab.classList.add('show');
    }

    function initFabDrag() {
        var fab = $('nx-inactive-fab');
        if (!fab) return;

        fab.addEventListener('click', function (e) {
            if (fab._dragging) return;
            showFabPopup();
        });

        var startX, startY, startBottom, startRight;

        fab.addEventListener('touchstart', function (e) {
            var t = e.touches[0];
            startX = t.clientX; startY = t.clientY;
            startBottom = parseInt(fab.style.bottom) || 100;
            startRight = parseInt(fab.style.right) || 20;
            fab._dragging = false;
        }, { passive: false });

        fab.addEventListener('touchmove', function (e) {
            e.preventDefault();
            var t = e.touches[0];
            var dx = t.clientX - startX; var dy = t.clientY - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                fab._dragging = true;
                fab.style.bottom = Math.max(20, Math.min(window.innerHeight - 80, startBottom - dy)) + 'px';
                fab.style.right = Math.max(20, Math.min(window.innerWidth - 80, startRight - dx)) + 'px';
            }
        }, { passive: false });

        fab.addEventListener('touchend', function () {
            setTimeout(function () { fab._dragging = false; }, 100);
        }, { passive: true });

        fab.addEventListener('mousedown', function (e) {
            e.preventDefault();
            startX = e.clientX; startY = e.clientY;
            startBottom = parseInt(fab.style.bottom) || 100;
            startRight = parseInt(fab.style.right) || 20;
            fab._dragging = false;
            function onMove(ev) {
                var dx = ev.clientX - startX; var dy = ev.clientY - startY;
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                    fab._dragging = true;
                    fab.style.bottom = Math.max(20, Math.min(window.innerHeight - 80, startBottom - dy)) + 'px';
                    fab.style.right = Math.max(20, Math.min(window.innerWidth - 80, startRight - dx)) + 'px';
                }
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                setTimeout(function () { fab._dragging = false; }, 100);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    /* ====================================================================
     * INCOMING CALL NUDGE (re-appears every 10s until activated)
     * ==================================================================== */
    var NUDGE_BRANDS = ['Opay', 'PalmPay', 'OKash'];
    var NUDGE_AMOUNTS = [2500, 3000, 1800, 4200, 1500, 5000];

    function buildIncomingCall() {
        var brand = NUDGE_BRANDS[Math.floor(Math.random() * NUDGE_BRANDS.length)];
        var amount = NUDGE_AMOUNTS[Math.floor(Math.random() * NUDGE_AMOUNTS.length)];
        var n = el('nx-incoming-call', '');
        n.innerHTML = `
            <div class="nx-ic-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M3 8C3 6.34315 4.34315 5 6 5H18C19.6569 5 21 6.34315 21 8V15C21 16.6569 19.6569 18 18 18H10L6 21V18H6C4.34315 18 3 16.6569 3 15V8Z" fill="#fff"/></svg>
            </div>
            <div class="nx-ic-info">
                <strong>Message from ${brand}</strong>
                <span>Read to earn &#8358;${amount.toLocaleString()}</span>
            </div>
            <button type="button" class="nx-ic-answer" data-nx-ic-answer>Read</button>
            <audio class="nx-ic-ringtone" src="ringtone.mp3" loop preload="auto" muted></audio>
        `;
        return n;
    }

    var incomingCallTimer = null;

    function showIncomingCall() {
        // Rebuild with a fresh random brand + amount
        var old = $('nx-incoming-call');
        if (old) {
            var fresh = buildIncomingCall();
            old.parentElement.replaceChild(fresh, old);
        }
        var n = $('nx-incoming-call');
        if (!n) return;
        n.classList.add('active');
        var ringtone = n.querySelector('.nx-ic-ringtone');
        if (ringtone) { try { ringtone.currentTime = 0; ringtone.play().catch(function(){}); } catch(_){} }
    }

    function hideIncomingCall() {
        var n = $('nx-incoming-call');
        if (!n) return;
        n.classList.remove('active');
        var ringtone = n.querySelector('.nx-ic-ringtone');
        if (ringtone) { try { ringtone.pause(); } catch(_){} }
    }

    function startIncomingCallLoop() {
        // Show after 1.2s on page load if not activated
        setTimeout(function () {
            if (!isActive()) showIncomingCall();
        }, 1200);

        // Wire the Answer button
        document.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-nx-ic-answer]');
            if (!btn) return;
            var ringtone = btn.parentElement.querySelector('.nx-ic-ringtone');
            if (ringtone) { try { ringtone.pause(); } catch(_){} }
            hideIncomingCall();
            showGate();
            // Re-show after 10s if still not activated
            if (incomingCallTimer) clearTimeout(incomingCallTimer);
            incomingCallTimer = setTimeout(function () {
                if (!isActive()) showIncomingCall();
            }, 15000);
        });
    }

    /* ====================================================================
     * EVENT WIRING
     * ==================================================================== */
    function wireEvents() {
        // Dismiss any modal/overlay when clicking outside its content
        document.addEventListener('click', function (e) {
            var overlay = e.target.closest('nx-gate.active, nx-esim-modal.active, nx-fav-popup.active, nx-success.active');
            if (!overlay) return;
            // If the click landed directly on the overlay (not a child), dismiss
            if (e.target === overlay) {
                if (overlay.tagName === 'NX-GATE') hideGate();
                else if (overlay.tagName === 'NX-ESIM-MODAL') hideEsimModal();
                else if (overlay.tagName === 'NX-FAV-POPUP') hideFavPopup();
                else if (overlay.tagName === 'NX-SUCCESS') hideSuccess();
                else if (overlay.tagName === 'NX-FAB-POPUP') hideFabPopup();
                else if (overlay.tagName === 'NX-WD-LOCKED') hideWithdrawLockedPopup();
            }
        });

        // Click delegation for all data-nx-* handlers
        document.addEventListener('click', function (e) {
            var t = e.target.closest('[data-nx-call],[data-nx-claim-btn],[data-nx-activate-btn],[data-nx-gate-activate],[data-nx-gate-close],[data-nx-esim-close],[data-nx-plan],[data-nx-add-fav],[data-nx-fav-pick],[data-nx-fav-close],[data-nx-vback],[data-nx-vverify],[data-nx-success-close],[data-nx-call-close],[data-nx-end-call],[data-nx-task-ai],[data-nx-task-line],[data-nx-see-all],[data-nx-open-esim],[data-nx-wd-close],[data-nx-wd-withdraw],[data-nx-open-withdraw],[data-nx-verify-cancel],[data-nx-get-esim],[data-nx-open-gate],[data-nx-fab-dismiss],[data-nx-fab-activate],[data-nx-wd-locked-close]');
            if (!t) return;
            e.preventDefault();

            if (t.hasAttribute('data-nx-call')) {
                startCall(t.getAttribute('data-nx-call'));
            } else if (t.hasAttribute('data-nx-claim-btn')) {
                claimCall();
            } else if (t.hasAttribute('data-nx-activate-btn') || t.hasAttribute('data-nx-gate-activate')) {
                hideGate();
                showEsimModal();
            } else if (t.hasAttribute('data-nx-gate-close')) {
                hideGate();
            } else if (t.hasAttribute('data-nx-esim-close')) {
                hideEsimModal();
            } else if (t.hasAttribute('data-nx-plan')) {
                e.preventDefault();
                var planId = t.getAttribute('data-nx-plan');
                setPlan(planId);
                hideEsimModal();
                startEsimPurchase(planId);
            } else if (t.hasAttribute('data-nx-add-fav')) {
                showFavPopup();
            } else if (t.hasAttribute('data-nx-fav-pick')) {
                try { saveSponsor(JSON.parse(t.getAttribute('data-nx-fav-pick'))); } catch (_) {}
            } else if (t.hasAttribute('data-nx-fav-close')) {
                hideFavPopup();
            } else if (t.hasAttribute('data-nx-vback')) {
                hideVerify();
                showWithdrawPage();
            } else if (t.hasAttribute('data-nx-vverify')) {
                verifyCode();
            } else if (t.hasAttribute('data-nx-success-close')) {
                completeWithdrawal();
            } else if (t.hasAttribute('data-nx-wd-close')) {
                hideWithdrawPage();
            } else if (t.hasAttribute('data-nx-wd-withdraw')) {
                // Bank details check FIRST
                var session = (window.NexAuth && NexAuth.session()) || {};
                if (!session.bankAccountName) {
                    showBankRequiredPopup();
                    return;
                }
                // Then balance check
                if (earnings() < CONST.WITHDRAW_THRESHOLD) {
                    showWithdrawLockedPopup();
                    return;
                }
                // Has bank details + balance — proceed to E-SIM verify
                var vsec = $('[data-nx-verify-section]');
                if (vsec) {
                    vsec.style.display = 'block';
                    var vb = $('[data-nx-vbalance]');
                    if (vb) vb.textContent = money(earnings());
                    vsec.scrollIntoView({ behavior: 'smooth' });
                } else {
                    hideWithdrawPage();
                    showVerify();
                }
            } else if (t.hasAttribute('data-nx-verify-cancel')) {
                var vsec2 = $('[data-nx-verify-section]');
                if (vsec2) vsec2.style.display = 'none';
            } else if (t.hasAttribute('data-nx-get-esim')) {
                // Build the eSIM modal on demand if it doesn't exist (transactions page)
                if (!$('nx-esim-modal')) {
                    document.body.appendChild(buildEsimModal());
                }
                showEsimModal();
            } else if (t.hasAttribute('data-nx-open-gate')) {
                e.preventDefault();
                showGate();
            } else if (t.hasAttribute('data-nx-fab-dismiss')) {
                hideFabPopup();
            } else if (t.hasAttribute('data-nx-fab-activate')) {
                hideFabPopup();
                showEsimModal();
            } else if (t.hasAttribute('data-nx-wd-locked-close')) {
                hideWithdrawLockedPopup();
            } else if (t.hasAttribute('data-nx-open-withdraw')) {
                e.preventDefault();
                showWithdrawPage();
            } else if (t.hasAttribute('data-nx-call-close') || t.hasAttribute('data-nx-end-call')) {
                endCall();
            } else if (t.hasAttribute('data-nx-task-ai')) {
                showGate();
            } else if (t.hasAttribute('data-nx-task-line')) {
                showGate();
            } else if (t.hasAttribute('data-nx-open-esim')) {
                e.preventDefault();
                showEsimModal();
            } else if (t.hasAttribute('data-nx-see-all')) {
                // Scroll to the phonebook section
                var pb = $('[data-nx-phonebook]');
                if (pb) pb.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });

        // Uppercase the verify input
        var vinput = $('[data-nx-vinput]');
        if (vinput) {
            vinput.addEventListener('input', function () {
                this.value = this.value.toUpperCase();
            });
        }
    }

    /* ====================================================================
     * AI CALL TASK (₦50,000) — calls 10 contacts at once
     * ==================================================================== */
    function runAiCallTask() {
        toast('This task is coming soon.');
    }

    function runLineCallTask() {
        toast('This task is coming soon.');
    }

    /* ====================================================================
     * INJECT INTO DASHBOARD
     * ==================================================================== */
    function injectIntoDashboard() {
        // Target the padded content container (the one with pb-[120px])
        // so injected tasks inherit the page padding and gap.
        var main = document.querySelector('.pb-\\[120px\\]');
        if (!main) {
            // Fallback: try the inner content area
            main = document.querySelector('.flex.flex-col.gap-6 .flex.flex-col.gap-6');
        }
        if (!main) return;
        main.appendChild(buildTasksSection());
    }

    /* ====================================================================
     * BOOT
     * ==================================================================== */
    function boot() {
        if (!document.body || document.body.getAttribute('data-auth') !== 'protected') return;

        injectCSS();

        // Detect which page we're on
        var isTransactions = /\/transactions\.html/.test(window.location.pathname);
        var isProfile = /\/profile\.html$/.test(window.location.pathname);
        var isEditProfile = /\/profile\/edit\.html/.test(window.location.pathname);
        var isChangePassword = /\/change-password\.html/.test(window.location.pathname);

        if (isTransactions) {
            document.body.appendChild(buildSuccessScreen());
            document.body.appendChild(buildIncomingCall());
            document.body.appendChild(buildInactiveFab());
            wireEvents();
            startIncomingCallLoop();
            initFabDrag();
            updateFabVisibility();
            wireTransactionsPage();
            setInterval(refreshTransactionsPage, 1000);
        } else if (isChangePassword) {
            wireEvents();
            wireChangePassword();
        } else if (isProfile) {
            document.body.appendChild(buildInactiveFab());
            wireEvents();
            initFabDrag();
            updateFabVisibility();
            personaliseProfile();
            wireBankAccount();
            setInterval(personaliseProfile, 2000);
        } else {
            // Dashboard — build overlays + inject tasks
            document.body.appendChild(buildGate());
            document.body.appendChild(buildEsimModal());
            document.body.appendChild(buildCallScreen());
            document.body.appendChild(buildClaimPopup());
            document.body.appendChild(buildFavPopup());
            document.body.appendChild(buildSuccessScreen());
            document.body.appendChild(buildIncomingCall());
            document.body.appendChild(buildInactiveFab());

            injectIntoDashboard();
            refreshAll();
            wireEvents();
            startIncomingCallLoop();
            initFabDrag();
            updateFabVisibility();
            setInterval(refreshWithdrawPage, 1000);
        }
    }

    /* ====================================================================
     * CHANGE PASSWORD — functional
     * ==================================================================== */
    function wireChangePassword() {
        var btn = document.querySelector('[data-action="save"]');
        if (!btn) return;
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            var form = btn.closest('div');
            var current = (document.querySelector('[data-model="current_password"]') || {}).value || '';
            var newPw = (document.querySelector('[data-model="password"]') || {}).value || '';
            var confirmPw = (document.querySelector('[data-model="password_confirmation"]') || {}).value || '';
            var s = (window.NexAuth && NexAuth.session()) || {};

            if (!current || !newPw || !confirmPw) { toast('Please fill in all fields.'); return; }
            if (current !== (s.password || '')) { toast('Current password is incorrect.'); return; }
            if (newPw.length < 6) { toast('New password must be at least 6 characters.'); return; }
            if (newPw !== confirmPw) { toast('Passwords do not match.'); return; }

            var updated = Object.assign({}, s, { password: newPw });
            if (window.NexAuth && NexAuth.store) NexAuth.store.login(updated);
            if (window.NexAuth && NexAuth.store) {
                var users = NexAuth.store.users();
                users.forEach(function (u) {
                    if (u.email === s.email || u.username === s.username) u.password = newPw;
                });
                localStorage.setItem('nx_users', JSON.stringify(users));
            }
            toast('Password updated successfully.', true);
            setTimeout(function () { window.location.href = 'profile.html'; }, 1000);
        });
    }

    /* ====================================================================
     * EDIT PROFILE — populate + save to localStorage
     * ==================================================================== */
    function wireEditProfile() {
        var s = (window.NexAuth && NexAuth.session()) || {};
        var parts = (s.fullName || '').split(/\s+/);
        setInput('[data-model="first_name"]', parts[0] || '');
        setInput('[data-model="last_name"]', parts.slice(1).join(' '));
        setInput('[data-model="phone"]', s.phone || '');
        var uname = document.querySelector('[data-model="username-display"]');
        if (uname) uname.textContent = '@' + (s.username || 'user');
        var email = document.querySelector('[data-model="email-display"]');
        if (email) email.textContent = s.email || '';

        var form = document.querySelector('[data-action="save-profile"]');
        if (!form) return;
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var first = val(form, 'first_name');
            var last = val(form, 'last_name');
            var phone = val(form, 'phone');
            var updated = Object.assign({}, s, {
                fullName: (first + ' ' + last).trim(),
                phone: phone
            });
            if (window.NexAuth && NexAuth.store) NexAuth.store.login(updated);
            // Update user record
            if (window.NexAuth && NexAuth.store) {
                var users = NexAuth.store.users();
                users.forEach(function (u) {
                    if (u.email === s.email || u.username === s.username) {
                        Object.assign(u, updated);
                    }
                });
                localStorage.setItem('nx_users', JSON.stringify(users));
            }
            toast('Profile saved successfully.', true);
            setTimeout(function () { window.location.href = '../profile.html'; }, 1000);
        }, true);
    }

    function setInput(sel, value) {
        var el = document.querySelector(sel);
        if (el && el.value !== undefined) el.value = value || '';
    }
    function val(ctx, name) {
        var el = ctx.querySelector('[data-model="' + name + '"]');
        return el ? (el.value || '').trim() : '';
    }

    /* ====================================================================
     * BANK ACCOUNT — verify via nualt API + save to localStorage
     * ==================================================================== */
    var NUALT_API_KEY = 'nualt_7iPi3PCfTkV1MfG1PfqNTyGP2_9c3LmFNHZZ4m_Be_I';
    var NUALT_BANKS = [{name:"3Line Card Management Limited",code:"110005"},{name:"9 Payment Service Bank",code:"120001"},{name:"AB Microfinance Bank",code:"090270"},{name:"ABU Microfinance Bank",code:"090197"},{name:"AG Mortgage Bank",code:"100028"},{name:"AL-Barakah Microfinance Bank",code:"090133"},{name:"AMJU Unique Microfinance Bank",code:"090180"},{name:"AMML MFB",code:"090116"},{name:"ASOSavings & Loans",code:"090001"},{name:"Aaa Finance",code:"050005"},{name:"Abbey Mortgage Bank",code:"070010"},{name:"Above Only Microfinance Bank",code:"090260"},{name:"Abucoop  Microfinance Bank",code:"090424"},{name:"Abulesoro Microfinance Bank Ltd",code:"090545"},{name:"Accelerex Network",code:"090202"},{name:"Access Bank",code:"044"},{name:"AccessMobile",code:"100013"},{name:"Accion Microfinance Bank",code:"090134"},{name:"Ada Microfinance Bank",code:"090483"},{name:"Addosser Microfinance Bank",code:"090160"},{name:"Adeyemi College Staff Microfinance Bank",code:"090268"},{name:"Afekhafe Microfinance Bank",code:"090292"},{name:"Afemai Microfinance Bank",code:"090518"},{name:"Agosasa Microfinance Bank",code:"090371"},{name:"Aku Microfinance Bank",code:"090531"},{name:"Akuchukwu Microfinance Bank Ltd",code:"090561"},{name:"Akwa Savings & Loans Limited",code:"070025"},{name:"Al-Hayat Microfinance Bank",code:"090277"},{name:"Alekun Microfinance Bank",code:"090259"},{name:"Alert Microfinance Bank",code:"090297"},{name:"Allworkers Microfinance Bank",code:"090131"},{name:"Ally Microfinance Bank",code:"090548"},{name:"Alpha Kapital Microfinance Bank",code:"090169"},{name:"Alvana Microfinance Bank",code:"090489"},{name:"Amac Microfinance Bank",code:"090394"},{name:"Ampersand Microfinance Bank",code:"090529"},{name:"Anchorage Microfinance Bank",code:"090476"},{name:"Aniocha Microfinance Bank",code:"090469"},{name:"Apeks Microfinance Bank",code:"090143"},{name:"Apple  Microfinance Bank",code:"090376"},{name:"Aramoko Microfinance Bank",code:"090307"},{name:"Arca Payments",code:"110011"},{name:"Arise Microfinance Bank",code:"090282"},{name:"Aspire Microfinance Bank Ltd",code:"090544"},{name:"Assets Matrix Microfinance Bank",code:"090287"},{name:"Assets Microfinance Bank",code:"090473"},{name:"Astrapolaris Microfinance Bank",code:"090172"},{name:"Atbu  Microfinance Bank",code:"090451"},{name:"Auchi Microfinance Bank",code:"090264"},{name:"Avuenegbe Microfinance Bank",code:"090478"},{name:"Aztec Microfinance Bank",code:"090540"},{name:"BC Kash Microfinance Bank",code:"090127"},{name:"BRIDGEWAY MICROFINANCE BANK",code:"090393"},{name:"Baines Credit Microfinance Bank",code:"090188"},{name:"Balera Microfinance Bank Ltd",code:"090563"},{name:"Balogun Fulani  Microfinance Bank",code:"090181"},{name:"Balogun Gambari Microfinance Bank",code:"090326"},{name:"Banex Microfinance Bank",code:"090425"},{name:"Baobab Microfinance Bank",code:"090136"},{name:"Bayero Microfinance Bank",code:"090316"},{name:"Benysta Microfinance Bank",code:"090413"},{name:"Beta-Access Yello",code:"100052"},{name:"Bipc Microfinance Bank",code:"090336"},{name:"Bishopgate Microfinance Bank",code:"090555"},{name:"Blue Investments Microfinance Bank",code:"090538"},{name:"Bluewhales  Microfinance Bank",code:"090431"},{name:"Boctrust Microfinance Bank",code:"090117"},{name:"Boi Mf Bank",code:"090444"},{name:"Boji Boji Microfinance Bank",code:"090494"},{name:"Bonghe Microfinance Bank",code:"090319"},{name:"Borgu Microfinance Bank",code:"090395"},{name:"Borno Renaissance Microfinance Bank",code:"090508"},{name:"Boromu Microfinance Bank",code:"090501"},{name:"Borstal Microfinance Bank",code:"090454"},{name:"Bosak Microfinance Bank",code:"090176"},{name:"Bowen Microfinance Bank",code:"090148"},{name:"Branch International Financial Services",code:"050006"},{name:"Brent Mortgage Bank",code:"070015"},{name:"Brethren Microfinance Bank",code:"090293"},{name:"Brightway Microfinance Bank",code:"090308"},{name:"Broadview Microfinance Bank Ltd",code:"090568"},{name:"Bubayero Microfinance Bank",code:"090512"},{name:"Bud Infrastructure Limited",code:"110021"},{name:"Business Support Microfinance Bank",code:"090406"},{name:"CEMCS Microfinance Bank",code:"090154"},{name:"CIT Microfinance Bank",code:"090144"},{name:"Calabar Microfinance Bank",code:"090415"},{name:"Capitalmetriq Swift Microfinance Bank",code:"090509"},{name:"Capricorn Digital",code:"110023"},{name:"Capstone Mf Bank",code:"090445"},{name:"Carbon",code:"100026"},{name:"Caretaker Microfinance Bank",code:"090472"},{name:"Cashconnect   Microfinance Bank",code:"090360"},{name:"Catland Microfinance Bank",code:"090498"},{name:"Cedar Microfinance Bank Ltd",code:"090562"},{name:"Cellulant",code:"100005"},{name:"Cellulant Pssp",code:"110012"},{name:"Central Bank Of Nigeria",code:"000028"},{name:"ChamsMobile",code:"303"},{name:"Chanelle Bank",code:"090397"},{name:"Chase Microfinance Bank",code:"090523"},{name:"Cherish Microfinance Bank",code:"090440"},{name:"Chibueze Microfinance Bank",code:"090416"},{name:"Chikum Microfinance Bank",code:"090141"},{name:"Chukwunenye  Microfinance Bank",code:"090490"},{name:"Cintrust Microfinance Bank",code:"090480"},{name:"Citi Bank",code:"023"},{name:"Citizen Trust Microfinance Bank Ltd",code:"090343"},{name:"Cloverleaf  Microfinance Bank",code:"090511"},{name:"Coalcamp Microfinance Bank",code:"090254"},{name:"Coastline Microfinance Bank",code:"090374"},{name:"Confidence Microfinance Bank Ltd",code:"090530"},{name:"Consistent Trust Microfinance Bank Ltd",code:"090553"},{name:"Consumer Microfinance Bank",code:"090130"},{name:"Contec Global Infotech Limited (NowNow)",code:"100032"},{name:"Coop Mortgage Bank",code:"070021"},{name:"Corestep Microfinance Bank",code:"090365"},{name:"Coronation Merchant Bank",code:"060001"},{name:"County Finance Ltd",code:"050001"},{name:"Covenant Microfinance Bank",code:"070006"},{name:"Credit Afrique Microfinance Bank",code:"090159"},{name:"Crescent Microfinance Bank",code:"090526"},{name:"Crossriver  Microfinance Bank",code:"090429"},{name:"Crowdforce",code:"110017"},{name:"Crutech  Microfinance Bank",code:"090414"},{name:"DOT MICROFINANCE BANK",code:"090470"},{name:"Davodani  Microfinance Bank",code:"090391"},{name:"Daylight Microfinance Bank",code:"090167"},{name:"Delta Trust Mortgage Bank",code:"070023"},{name:"ENaira",code:"000033"},{name:"Eagle Flight Microfinance Bank",code:"090294"},{name:"Eartholeum",code:"100021"},{name:"Ebsu Microfinance Bank",code:"090427"},{name:"EcoBank PLC",code:"050"},{name:"EcoMobile",code:"100030"},{name:"Ecobank Xpress Account",code:"100008"},{name:"Edfin Microfinance Bank",code:"090310"},{name:"Egwafin Microfinance Bank Ltd",code:"090556"},{name:"Ek-Reliable Microfinance Bank",code:"090389"},{name:"Ekimogun Microfinance Bank",code:"090552"},{name:"Ekondo MFB",code:"090097"},{name:"Emeralds Microfinance Bank",code:"090273"},{name:"Empire trust MFB",code:"090114"},{name:"Enrich Microfinance Bank",code:"090539"},{name:"Enterprise Bank",code:"000019"},{name:"Esan Microfinance Bank",code:"090189"},{name:"Eso-E Microfinance Bank",code:"090166"},{name:"Evangel Microfinance Bank",code:"090304"},{name:"Evergreen Microfinance Bank",code:"090332"},{name:"Ewt Microfinance Bank",code:"090572"},{name:"Excellent Microfinance Bank",code:"090541"},{name:"Eyowo MFB",code:"090328"},{name:"FAST Microfinance Bank",code:"090179"},{name:"FBN Mortgages Limited",code:"090107"},{name:"FBNMobile",code:"100014"},{name:"FBNQUEST Merchant Bank",code:"060002"},{name:"FCMB Easy Account",code:"100031"},{name:"FEDETH MICROFINANCE BANK",code:"090482"},{name:"FET",code:"100001"},{name:"FFS Microfinance Bank",code:"090153"},{name:"FINATRUST MICROFINANCE BANK",code:"608"},{name:"FSDH Merchant Bank",code:"400001"},{name:"Fairmoney Microfinance Bank Ltd",code:"090551"},{name:"Fame Microfinance Bank",code:"090330"},{name:"Fcmb Microfinance Bank",code:"090409"},{name:"Fct Microfinance Bank",code:"090290"},{name:"Federal Polytechnic Nekede Microfinance Bank",code:"090398"},{name:"Federal University Dutse  Microfinance Bank",code:"090318"},{name:"Federalpoly Nasarawamfb",code:"090298"},{name:"Fewchore Finance Company Limited",code:"050002"},{name:"Fha Mortgage Bank Ltd",code:"070026"},{name:"Fidelity Bank",code:"070"},{name:"Fidelity Mobile",code:"100019"},{name:"Fidfund Microfinance Bank",code:"090126"},{name:"Fims Microfinance Bank",code:"090507"},{name:"Finca Microfinance Bank",code:"090400"},{name:"Firmus MFB",code:"090366"},{name:"First Bank PLC",code:"011"},{name:"First City Monument Bank",code:"214"},{name:"First Generation Mortgage Bank",code:"070014"},{name:"First Heritage Microfinance Bank",code:"090479"},{name:"First Multiple Microfinance Bank",code:"090163"},{name:"First Option Microfinance Bank",code:"090285"},{name:"First Royal Microfinance Bank",code:"090164"},{name:"Firstmidas Microfinance Bank Ltd",code:"090575"},{name:"Flutterwave Technology Solutions Limited",code:"110002"},{name:"Foresight Microfinance Bank",code:"090521"},{name:"Fortis Microfinance Bank",code:"070002"},{name:"FortisMobile",code:"100016"},{name:"Fortress Microfinance Bank",code:"090486"},{name:"Fullrange Microfinance Bank",code:"090145"},{name:"Futminna Microfinance Bank",code:"090438"},{name:"Futo Microfinance Bank",code:"090158"},{name:"GOODNEWS MFB",code:"090495"},{name:"GTMobile",code:"100009"},{name:"Garki Microfinance Bank",code:"090484"},{name:"Gashua Microfinance Bank",code:"090168"},{name:"Gateway Mortgage Bank",code:"070009"},{name:"Gbede Microfinance Bank",code:"090579"},{name:"Giant Stride Microfinance Bank",code:"090475"},{name:"Giginya Microfinance Bank",code:"090411"},{name:"Girei Microfinance Bank",code:"090186"},{name:"Giwa Microfinance Bank",code:"090441"},{name:"Globus Bank",code:"103"},{name:"Glory Microfinance Bank",code:"090278"},{name:"Gmb Microfinance Bank",code:"090408"},{name:"GoMoney",code:"100022"},{name:"Good Neighbours Microfinance Bank",code:"090467"},{name:"Gowans Microfinance Bank",code:"090122"},{name:"Green Energy Microfinance Bank Ltd",code:"090550"},{name:"GreenBank Microfinance Bank",code:"090178"},{name:"Greenville Microfinance Bank",code:"090269"},{name:"Greenwich Merchant Bank",code:"060004"},{name:"Grooming Microfinance Bank",code:"090195"},{name:"Gti  Microfinance Bank",code:"090385"},{name:"Guaranty Trust Bank",code:"058"},{name:"Gwong Microfinance Bank",code:"090500"},{name:"Hackman Microfinance Bank",code:"090147"},{name:"Haggai Mortgage Bank Limited",code:"070017"},{name:"Halacredit Microfinance Bank",code:"090291"},{name:"Hasal Microfinance Bank",code:"090121"},{name:"Headway Microfinance Bank",code:"090363"},{name:"Hedonmark",code:"100017"},{name:"Heritage Bank",code:"030"},{name:"HighStreet Microfinance Bank",code:"090175"},{name:"Highland Microfinance Bank",code:"090418"},{name:"Homebase Mortgage",code:"070024"},{name:"Hopepsb",code:"120002"},{name:"IBILE Microfinance Bank",code:"090118"},{name:"IRL Microfinance Bank",code:"090149"},{name:"Ibeto  Microfinance Bank",code:"090439"},{name:"Ibolo Micorfinance Bank Ltd",code:"090532"},{name:"Ibom Fadama Microfinance Bank",code:"090519"},{name:"Ibu-Aje Microfinance",code:"090488"},{name:"Ic Globalmicrofinance Bank",code:"090520"},{name:"Ijebu-Ife Microfinance Bank Ltd",code:"090546"},{name:"Ikenne Microfinance Bank",code:"090324"},{name:"Ikire Microfinance Bank",code:"090279"},{name:"Ikoyi-Osun Microfinance Bank",code:"090536"},{name:"Ilaro Poly Microfinance Bank Ltd",code:"090571"},{name:"Ilasan Microfinance Bank",code:"090370"},{name:"Illorin Microfinance Bank",code:"090350"},{name:"Ilora Microfinance Bank",code:"090430"},{name:"Imo State Microfinance Bank",code:"090258"},{name:"Imowo Microfinance Bank",code:"090417"},{name:"Imperial Homes Mortgage Bank",code:"100024"},{name:"Infinity Microfinance Bank",code:"090157"},{name:"Infinity Trust Mortgage Bank",code:"070016"},{name:"Innovectives Kesh",code:"100029"},{name:"Insight Microfinance Bank",code:"090434"},{name:"Intellifin",code:"100027"},{name:"Interland Microfinance Bank",code:"090386"},{name:"Interswitch Financial Inclusion Services (Ifis)",code:"110010"},{name:"Interswitch Limited",code:"110003"},{name:"Iperu Microfinance Bank",code:"090493"},{name:"Isaleoyo Microfinance Bank",code:"090377"},{name:"Ishie  Microfinance Bank",code:"090428"},{name:"Isuofia Microfinance Bank",code:"090353"},{name:"Itex Integrated Services Limited",code:"090211"},{name:"Iwade Microfinance Bank Ltd",code:"090578"},{name:"Iwoama Microfinance Bank",code:"090543"},{name:"Iyamoye Microfinance Bank Ltd",code:"090570"},{name:"Iyeru Okin Microfinance Bank Ltd",code:"090337"},{name:"Izon Microfinance Bank",code:"090421"},{name:"Jaiz Bank",code:"301"},{name:"Jessefield Microfinance Bank",code:"090352"},{name:"Jubilee-Life Mortgage  Bank",code:"090003"},{name:"KCMB Microfinance Bank",code:"090191"},{name:"Kadick Integration Limited",code:"110008"},{name:"Kadpoly Microfinance Bank",code:"090320"},{name:"Kayvee Microfinance Bank",code:"090554"},{name:"Kc Microfinance Bank",code:"090549"},{name:"Kegow",code:"100015"},{name:"Kegow(Chamsmobile)",code:"100036"},{name:"Keystone Bank",code:"082"},{name:"Kingdom College  Microfinance Bank",code:"090487"},{name:"Kontagora Microfinance Bank",code:"090299"},{name:"Koraypay",code:"110022"},{name:"Kredi Money Microfinance Bank",code:"090380"},{name:"Kuda",code:"090267"},{name:"Kwasu Mf Bank",code:"090450"},{name:"La  Fayette Microfinance Bank",code:"090155"},{name:"Lagos Building Investment Company",code:"070012"},{name:"Landgold  Microfinance Bank",code:"090422"},{name:"Lapo Microfinance Bank",code:"090177"},{name:"Lavender Microfinance Bank",code:"090271"},{name:"Legend Microfinance Bank",code:"090372"},{name:"Letshego MFB",code:"090420"},{name:"Lifegate Microfinance Bank Ltd",code:"090557"},{name:"Light Microfinance Bank",code:"090477"},{name:"Links Microfinance Bank",code:"090435"},{name:"Lobrem Microfinance Bank",code:"090537"},{name:"Lotus Bank",code:"000029"},{name:"Lovonus Microfinance Bank",code:"090265"},{name:"M36",code:"100035"},{name:"MAUTECH Microfinance Bank",code:"090423"},{name:"Mainland Microfinance Bank",code:"090323"},{name:"Mainstreet Microfinance Bank",code:"090171"},{name:"Maintrust Microfinance Bank",code:"090465"},{name:"Malachy Microfinance Bank",code:"090174"},{name:"Manny Microfinance bank",code:"090383"},{name:"Maritime Microfinance Bank",code:"090410"},{name:"Mayfair  Microfinance Bank",code:"090321"},{name:"Mayfresh Mortgage Bank",code:"070019"},{name:"Megapraise Microfinance Bank",code:"090280"},{name:"Memphis Microfinance Bank",code:"090432"},{name:"Mercury MFB",code:"090589"},{name:"Meridian Microfinance Bank",code:"090275"},{name:"Mgbidi Microfinance Bank",code:"090528"},{name:"Microsystems Investment And Development Limited",code:"110018"},{name:"Microvis Microfinance Bank",code:"090113"},{name:"Midland Microfinance Bank",code:"090192"},{name:"Mint-Finex MICROFINANCE BANK",code:"090281"},{name:"Mkudi",code:"100011"},{name:"Molusi Microfinance Bank",code:"090362"},{name:"Momo Psb",code:"120003"},{name:"Monarch Microfinance Bank",code:"090462"},{name:"Money Master Psb",code:"120005"},{name:"Money Trust Microfinance Bank",code:"090129"},{name:"MoneyBox",code:"100020"},{name:"Moniepoint Microfinance Bank",code:"090405"},{name:"Moyofade Mf Bank",code:"090448"},{name:"Mozfin Microfinance Bank",code:"090392"},{name:"Mutual Benefits Microfinance Bank",code:"090190"},{name:"Mutual Trust Microfinance Bank",code:"090151"},{name:"NIP Virtual Bank",code:"999999"},{name:"NIRSAL Microfinance Bank",code:"090194"},{name:"NPF MicroFinance Bank",code:"070001"},{name:"Nagarta Microfinance Bank",code:"090152"},{name:"Nasarawa Microfinance Bank",code:"090349"},{name:"Navy Microfinance Bank",code:"090263"},{name:"Ndiorah Microfinance Bank",code:"090128"},{name:"Neptune Microfinance Bank",code:"090329"},{name:"Netapps Technology Limited",code:"110025"},{name:"New Dawn Microfinance Bank",code:"090205"},{name:"New Golden Pastures Microfinance Bank",code:"090378"},{name:"New Prudential Bank",code:"090108"},{name:"Newedge Finance Ltd",code:"050004"},{name:"Nibssussd Payments",code:"110019"},{name:"Nice Microfinance Bank",code:"090459"},{name:"Nigeria Prisonsmicrofinance Bank",code:"090505"},{name:"Nkpolu-Ust Microfinance",code:"090535"},{name:"Nomba Financial Services Limited",code:"110028"},{name:"Nova Merchant Bank",code:"060003"},{name:"Nsuk  Microfinance Bank",code:"090491"},{name:"Numo Microfinance Bank",code:"090516"},{name:"Nuture Microfinance Bank",code:"090364"},{name:"Nwannegadi Microfinance Bank",code:"090399"},{name:"Oakland Microfinance Bank",code:"090437"},{name:"Oau Microfinance Bank Ltd",code:"090345"},{name:"Oche Microfinance Bank",code:"090333"},{name:"Octopus Microfinance Bank Ltd",code:"090576"},{name:"Ohafia Microfinance Bank",code:"090119"},{name:"Ojokoro Microfinance Bank",code:"090527"},{name:"Oke-Aro Oredegbe Microfinance Bank Ltd",code:"090565"},{name:"Okpoga Microfinance Bank",code:"090161"},{name:"Okuku Microfinance Bank Ltd",code:"090566"},{name:"Olabisi Onabanjo University Microfinance Bank",code:"090272"},{name:"Olofin Owena Microfinance Bank",code:"090468"},{name:"Olowolagba Microfinance Bank",code:"090404"},{name:"Oluchukwu Microfinance Bank",code:"090471"},{name:"Oluyole Microfinance Bank",code:"090460"},{name:"Omiye Microfinance Bank",code:"090295"},{name:"Omoluabi savings and loans",code:"070007"},{name:"One Finance",code:"100026"},{name:"Opay",code:"100004"},{name:"Optimus Bank",code:"000036"},{name:"Oraukwu  Microfinance Bank",code:"090492"},{name:"Orokam Microfinance Bank Ltd",code:"090567"},{name:"Oscotech Microfinance Bank",code:"090396"},{name:"Ospoly Microfinance Bank",code:"090456"},{name:"Otech Microfinance Bank Ltd",code:"090580"},{name:"Otuo Microfinance Bank Ltd",code:"090542"},{name:"PALMPAY",code:"100033"},{name:"Paga",code:"327"},{name:"Page Financials",code:"070008"},{name:"Palmcoast Microfinance Bank",code:"090497"},{name:"Parallex Bank",code:"000030"},{name:"Parkway Mf Bank",code:"090390"},{name:"Parkway-ReadyCash",code:"100003"},{name:"Parralex Microfinance bank",code:"090004"},{name:"PatrickGold Microfinance Bank",code:"090317"},{name:"PayAttitude Online",code:"110001"},{name:"Paycom",code:"305"},{name:"Paystack Payments Limited",code:"110006"},{name:"Peace Microfinance Bank",code:"090402"},{name:"PecanTrust Microfinance Bank",code:"090137"},{name:"Peniel Micorfinance Bank Ltd",code:"090379"},{name:"Pennywise Microfinance Bank",code:"090196"},{name:"Personal Trust Microfinance Bank",code:"090135"},{name:"Petra Microfinance Bank",code:"090165"},{name:"Pillar Microfinance Bank",code:"090289"},{name:"Platinum Mortgage Bank",code:"070013"},{name:"Polaris bank",code:"076"},{name:"Polyibadan Microfinance Bank",code:"090534"},{name:"Polyuwanna Microfinance Bank",code:"090296"},{name:"Preeminent Microfinance Bank",code:"090412"},{name:"PremiumTrust Bank",code:"000031"},{name:"Prestige Microfinance Bank",code:"090274"},{name:"Prisco  Microfinance Bank",code:"090481"},{name:"Pristine Divitis Microfinance Bank",code:"090499"},{name:"Projects Microfinance Bank",code:"090503"},{name:"ProvidusBank PLC",code:"101"},{name:"Purplemoney Microfinance Bank",code:"090303"},{name:"Qr Payments",code:"110013"},{name:"Qube Microfinance Bank Ltd",code:"090569"},{name:"Quickfund Microfinance Bank",code:"090261"},{name:"Radalpha Microfinance Bank",code:"090496"},{name:"Rahama Microfinance Bank",code:"090170"},{name:"Rand merchant Bank",code:"502"},{name:"Refuge Mortgage Bank",code:"070011"},{name:"Regent Microfinance Bank",code:"090125"},{name:"Rehoboth Microfinance Bank",code:"090463"},{name:"Reliance Microfinance Bank",code:"090173"},{name:"RenMoney Microfinance Bank",code:"090198"},{name:"Rephidim Microfinance Bank",code:"090322"},{name:"Resident Fintech Limited",code:"110024"},{name:"Richway Microfinance Bank",code:"090132"},{name:"Rigo Microfinance Bank",code:"090433"},{name:"Rima Growth Pathway Microfinance Bank",code:"090515"},{name:"Rima Microfinance Bank",code:"090443"},{name:"Rockshield Microfinance Bank",code:"090547"},{name:"Royal Exchange Microfinance Bank",code:"090138"},{name:"Rubies Microfinance Bank",code:"090175"},{name:"Safe Haven MFB",code:"090286"},{name:"SafeTrust",code:"090006"},{name:"Safegate Microfinance Bank",code:"090485"},{name:"Sagamu Microfinance Bank",code:"090140"},{name:"Sagegrey Finance Limited",code:"050003"},{name:"Seap Microfinance Bank",code:"090513"},{name:"Seed Capital Microfinance Bank",code:"090112"},{name:"Seedvest Microfinance Bank",code:"090369"},{name:"Shalom Microfinance Bank",code:"090502"},{name:"Shepherd Trust Microfinance Bank",code:"090401"},{name:"Shield Microfinance Bank Ltd",code:"090559"},{name:"Shongom Microfinance Bank Ltd",code:"090558"},{name:"Sls  Mf Bank",code:"090449"},{name:"Smartcash Payment Service Bank",code:"120004"},{name:"Snow Microfinance Bank",code:"090573"},{name:"Solid Allianze Microfinance Bank",code:"090506"},{name:"Solidrock Microfinance Bank",code:"090524"},{name:"Sparkle",code:"090325"},{name:"Spay Business",code:"110026"},{name:"Spectrum Microfinance Bank",code:"090436"},{name:"Stanbic IBTC @ease wallet",code:"100007"},{name:"Stanbic IBTC Bank",code:"221"},{name:"Standard Chaterted bank PLC",code:"068"},{name:"Standard Microfinance Bank",code:"090182"},{name:"Stanford Microfinance Bak",code:"090162"},{name:"Stb Mortgage Bank",code:"070022"},{name:"Stellas Microfinance Bank",code:"090262"},{name:"Sterling Bank PLC",code:"232"},{name:"Stockcorp  Microfinance Bank",code:"090340"},{name:"Sulsap Microfinance Bank",code:"090305"},{name:"Sunbeam Microfinance Bank",code:"090302"},{name:"Suntrust Bank",code:"100"},{name:"Support Mf Bank",code:"090446"},{name:"Supreme Microfinance Bank Ltd",code:"090564"},{name:"TANADI MFB (CRUST)",code:"090560"},{name:"TCF MFB",code:"090115"},{name:"TagPay",code:"100023"},{name:"Taj Bank Limited",code:"000026"},{name:"Tajwallet",code:"080002"},{name:"Tangerine Bank",code:"090426"},{name:"TeamApt",code:"110007"},{name:"TeasyMobile",code:"100010"},{name:"Tf Microfinance Bank",code:"090373"},{name:"Thrive Microfinance Bank",code:"090283"},{name:"Titan Trust Bank",code:"000025"},{name:"Titan-Paystack",code:"100039"},{name:"Trident Microfinance Bank",code:"090146"},{name:"Triple A Microfinance Bank",code:"090525"},{name:"Trust Microfinance Bank",code:"090327"},{name:"Trustbond Mortgage Bank",code:"090005"},{name:"Trustfund Microfinance Bank",code:"090276"},{name:"U And C Microfinance Bank",code:"090315"},{name:"UNN MFB",code:"090251"},{name:"Uda Microfinance Bank",code:"090403"},{name:"Uhuru Microfinance Bank",code:"090517"},{name:"Umuchinemere Procredit Microfinance Bank",code:"090514"},{name:"Umunnachi Microfinance Bank",code:"090510"},{name:"Unaab Microfinance Bank",code:"090331"},{name:"Uniben Microfinance Bank",code:"090266"},{name:"Unical Microfinance Bank",code:"090193"},{name:"Uniibadan Microfinance Bank",code:"090461"},{name:"Unilag  Microfinance Bank",code:"090452"},{name:"Unilorin Microfinance Bank",code:"090341"},{name:"Unimaid Microfinance Bank",code:"090464"},{name:"Union Bank PLC",code:"032"},{name:"United Bank for Africa",code:"033"},{name:"Unity Bank PLC",code:"215"},{name:"Uniuyo Microfinance Bank",code:"090338"},{name:"Uzondu Mf Bank",code:"090453"},{name:"VFD Micro Finance Bank",code:"090110"},{name:"VTNetworks",code:"100012"},{name:"Vas2Nets Limited",code:"110015"},{name:"Verdant Microfinance Bank",code:"090474"},{name:"Verite Microfinance Bank",code:"090123"},{name:"Virtue Microfinance Bank",code:"090150"},{name:"Visa Microfinance Bank",code:"090139"},{name:"Wema Bank PLC",code:"035"},{name:"Wetland Microfinance Bank",code:"090120"},{name:"Winview Bank",code:"090419"},{name:"Woven Finance",code:"110029"},{name:"Xpress Payments",code:"090201"},{name:"Xslnce Microfinance Bank",code:"090124"},{name:"Yct Microfinance Bank",code:"090466"},{name:"Yello Digital Financial Services",code:"110027"},{name:"Yes Microfinance Bank",code:"090142"},{name:"Yobe Microfinance Bank",code:"090252"},{name:"Zenith bank PLC",code:"057"},{name:"ZenithMobile",code:"100018"},{name:"Zikora Microfinance Bank",code:"090504"},{name:"Zinternet Nigera Limited",code:"100025"},{name:"Zwallet",code:"100034"},{name:"e-Barcs Microfinance Bank",code:"090156"},{name:"eTranzact",code:"100006"}];

    function showSavedPopup(bankName, acctNum, acctName) {
        var overlay = el('div', '');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;';
        overlay.innerHTML = '<div style="background:#fff;border-radius:28px;padding:36px 28px;max-width:360px;width:100%;text-align:center;animation:nxFabPop 0.35s cubic-bezier(0.34,1.2,0.64,1);">' +
            '<div style="width:72px;height:72px;margin:0 auto 20px;border-radius:50%;background:rgba(52,199,89,0.1);display:flex;align-items:center;justify-content:center;">' +
                '<svg viewBox="0 0 24 24" width="36" height="36" fill="none"><circle cx="12" cy="12" r="10" stroke="#34c759" stroke-width="2"/><path d="M8 12.5L11 15.5L16.5 9.5" stroke="#34c759" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</div>' +
            '<h3 style="font-size:22px;font-weight:700;color:#18443e;margin:0 0 10px;">Account Details Saved</h3>' +
            '<p style="font-size:14px;color:#8c8c8c;margin:0 0 20px;line-height:1.5;">Your bank account details have been saved successfully.</p>' +
            '<div style="background:rgba(24,68,62,0.05);border-radius:14px;padding:16px;margin-bottom:24px;text-align:left;">' +
                '<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="font-size:12px;color:#8c8c8c;">Bank</span><span style="font-size:13px;font-weight:600;color:#18443e;">' + bankName + '</span></div>' +
                '<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="font-size:12px;color:#8c8c8c;">Account Number</span><span style="font-size:13px;font-weight:600;color:#18443e;">' + acctNum + '</span></div>' +
                '<div style="display:flex;justify-content:space-between;"><span style="font-size:12px;color:#8c8c8c;">Account Name</span><span style="font-size:13px;font-weight:600;color:#18443e;">' + acctName + '</span></div>' +
            '</div>' +
            '<button type="button" style="width:100%;padding:14px;border-radius:999px;background:#18443e;color:#fff;border:none;font-weight:600;font-size:15px;cursor:pointer;">Done</button>' +
        '</div>';
        document.body.appendChild(overlay);
        overlay.querySelector('button').addEventListener('click', function () { overlay.remove(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    }

    function wireBankAccount() {
        var bankSearch = document.getElementById('bankSearch');
        var bankCode = document.getElementById('bankCode');
        var bankDropdown = document.getElementById('bankDropdown');
        var acctInput = document.getElementById('accountNumberInput');
        var verifyBtn = document.getElementById('verifyAccountBtn');
        var saveBtn = document.getElementById('saveAccountBtn');
        var nameDisplay = document.getElementById('accountNameDisplay');
        var nameBox = document.getElementById('accountNameBox');
        if (!bankSearch || !verifyBtn) return;

        // Bank search functionality
        bankSearch.addEventListener('input', function () {
            var q = this.value.toLowerCase().trim();
            if (!q || q.length < 1) { bankDropdown.style.display = 'none'; return; }
            var matches = NUALT_BANKS.filter(function (b) {
                return b.name.toLowerCase().indexOf(q) !== -1;
            }).slice(0, 20);
            if (!matches.length) { bankDropdown.style.display = 'none'; return; }
            bankDropdown.innerHTML = matches.map(function (b) {
                return '<div data-bank-code="' + b.code + '" data-bank-name="' + b.name.replace(/"/g, '&quot;') + '" style="padding:10px 14px;cursor:pointer;font-size:13px;color:#1a1a1a;border-bottom:1px solid rgba(0,0,0,0.04);">' + b.name + '</div>';
            }).join('');
            bankDropdown.style.display = 'block';
        });

        bankDropdown.addEventListener('click', function (e) {
            var item = e.target.closest('[data-bank-code]');
            if (!item) return;
            bankCode.value = item.getAttribute('data-bank-code');
            bankSearch.value = item.getAttribute('data-bank-name');
            bankDropdown.style.display = 'none';
            resetVerified();
        });

        // Close dropdown on outside click
        document.addEventListener('click', function (e) {
            if (!e.target.closest('#bankSearch') && !e.target.closest('#bankDropdown')) {
                bankDropdown.style.display = 'none';
            }
        });

        // Load saved data
        var session = (window.NexAuth && NexAuth.session()) || {};
        if (session.bankCode) {
            bankCode.value = session.bankCode;
            bankSearch.value = session.bankName || '';
        }
        if (session.bankAccountNumber) acctInput.value = session.bankAccountNumber;
        if (session.bankAccountName) {
            nameDisplay.textContent = session.bankAccountName;
            nameDisplay.style.color = '#18443e';
            nameBox.style.borderColor = '#18443e';
            saveBtn.style.display = 'none';
            verifyBtn.style.display = 'none';
            // Show "Saved" state
            var savedBtn = document.createElement('button');
            savedBtn.id = 'savedStatusBtn';
            savedBtn.className = 'w-full h-[45px] rounded-full font-heading font-semibold text-[14px] cursor-default';
            savedBtn.style.cssText = 'background:rgba(52,199,89,0.1);color:#34c759;display:block;';
            savedBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" style="display:inline;vertical-align:middle;margin-right:6px;"><path d="M5 13l4 4 10-10" stroke="#34c759" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Saved';
            saveBtn.parentElement.appendChild(savedBtn);
        }

        // Reset to re-verify only when user actually changes bank or account number
        function resetVerified() {
            var currentBank = bankCode.value;
            var currentAcct = acctInput.value.trim();
            var session = (window.NexAuth && NexAuth.session()) || {};
            // If values match what's saved, keep "Saved" state
            if (currentBank === (session.bankCode || '') && currentAcct === (session.bankAccountNumber || '')) {
                return;
            }
            var savedStatus = document.getElementById('savedStatusBtn');
            if (savedStatus) savedStatus.remove();
            window._verifiedBank = null;
            saveBtn.style.display = 'none';
            verifyBtn.style.display = 'block';
            verifyBtn.textContent = 'Re-verify';
            nameDisplay.textContent = 'Enter account number to verify';
            nameDisplay.style.color = '#8c8c8c';
            nameBox.style.borderColor = '';
        }
        bankSearch.addEventListener('input', function () { resetVerified(); });
        acctInput.addEventListener('input', resetVerified);

        verifyBtn.addEventListener('click', function () {
            var bank = bankCode.value;
            var acct = acctInput.value.trim();
            if (!bank) { toast('Please select your bank.'); return; }
            if (acct.length !== 10) { toast('Enter a valid 10-digit account number.'); return; }

            nameDisplay.textContent = 'Verifying…';
            nameDisplay.style.color = '#8c8c8c';
            verifyBtn.disabled = true;
            verifyBtn.textContent = 'Verifying…';

            fetch('https://corsproxy.io/?url=' + encodeURIComponent('https://nu-alt.shop/v1/resolve?acc_no=' + acct + '&bank=' + bank), {
                headers: { 'Authorization': 'Bearer ' + NUALT_API_KEY }
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                verifyBtn.disabled = false;
                verifyBtn.textContent = 'Verify Account';
                if (data.ok && data.result && data.result[0] && data.result[0].account_name) {
                    var name = data.result[0].account_name;
                    nameDisplay.textContent = name;
                    nameDisplay.style.color = '#18443e';
                    nameBox.style.borderColor = '#18443e';
                    saveBtn.style.display = 'block';
                    verifyBtn.style.display = 'none';
                    window._verifiedBank = { bankCode: bank, bankName: bankSearch.value, accountNumber: acct, accountName: name };
                    toast('Account verified successfully.', true);
                } else {
                    nameDisplay.textContent = 'Could not verify account. Check details.';
                    nameDisplay.style.color = '#ff4d6d';
                    toast('Verification failed. Check your details.');
                }
            })
            .catch(function () {
                verifyBtn.disabled = false;
                verifyBtn.textContent = 'Verify Account';
                nameDisplay.textContent = 'Verification failed. Try again.';
                nameDisplay.style.color = '#ff4d6d';
                toast('Network error. Try again.');
            });
        });

        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                if (!window._verifiedBank) { toast('Verify your account first.'); return; }
                var s = (window.NexAuth && NexAuth.session()) || {};
                var updated = Object.assign({}, s, {
                    bankCode: window._verifiedBank.bankCode,
                    bankName: window._verifiedBank.bankName,
                    bankAccountNumber: window._verifiedBank.accountNumber,
                    bankAccountName: window._verifiedBank.accountName
                });
                if (window.NexAuth && NexAuth.store) {
                    NexAuth.store.login(updated);
                    var users = NexAuth.store.users();
                    users.forEach(function (u) {
                        if (u.email === s.email || u.username === s.username) Object.assign(u, updated);
                    });
                    localStorage.setItem('nx_users', JSON.stringify(users));
                }
                saveBtn.style.display = 'none';
                verifyBtn.style.display = 'none';
                var savedBtn = document.getElementById('savedStatusBtn');
                if (!savedBtn) {
                    savedBtn = document.createElement('button');
                    savedBtn.id = 'savedStatusBtn';
                    savedBtn.className = 'w-full h-[45px] rounded-full font-heading font-semibold text-[14px] cursor-default';
                    savedBtn.style.cssText = 'background:rgba(52,199,89,0.1);color:#34c759;display:block;';
                    savedBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" style="display:inline;vertical-align:middle;margin-right:6px;"><path d="M5 13l4 4 10-10" stroke="#34c759" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Saved';
                    saveBtn.parentElement.appendChild(savedBtn);
                }
                showSavedPopup(updated.bankName, updated.bankAccountNumber, updated.bankAccountName);
            });
        }
    }

    /* ====================================================================
     * PROFILE PAGE — personalise from localStorage
     * ==================================================================== */
    function personaliseProfile() {
        var s = (window.NexAuth && NexAuth.session()) || {};
        var fullName = s.fullName || s.username || 'User';
        var username = s.username || 'user';
        var email = s.email || '';
        var avatar = $('[data-nx-avatar]');
        var nameEl = $('[data-nx-fullname]');
        var infoEl = $('[data-nx-userinfo]');

        if (avatar) avatar.textContent = fullName.charAt(0).toUpperCase();
        if (nameEl) nameEl.textContent = fullName;
        if (infoEl) infoEl.textContent = '@' + username + (email ? ' · ' + email : '');

        // Plan badge
        var badge = $('[data-nx-plan-badge]');
        if (badge) {
            if (isActive()) {
                badge.style.background = 'rgba(24,68,62,0.1)';
                badge.style.color = '#18443e';
                badge.innerHTML = '<span class="size-1.5 rounded-full" style="background:#18443e;"></span>Royal eSIM';
            } else {
                badge.style.background = 'rgba(255,77,109,0.1)';
                badge.style.color = '#ff4d6d';
                badge.innerHTML = '<span class="size-1.5 rounded-full" style="background:#ff4d6d;"></span>Account Inactive';
            }
        }
    }

    /* ====================================================================
     * TRANSACTIONS PAGE — inline withdraw logic
     * ==================================================================== */
    function wireTransactionsPage() {
        refreshTransactionsPage();
        renderWithdrawHistoryInline();

        // Wire the inline verify input
        var input = $('[data-nx-vinput]');
        if (input) {
            input.addEventListener('input', function () {
                this.value = this.value.toUpperCase().slice(0, 13);
                this.classList.remove('error');
                var err = $('[data-nx-verr]');
                if (err) err.textContent = '';
            });
        }
    }

    function refreshTransactionsPage() {
        var total = earnings();
        var balEl = $('[data-nx-wd-balance]');
        var pctEl = $('[data-nx-wd-percent]');
        var fillEl = $('[data-nx-wd-fill]');
        var remainEl = $('[data-nx-wd-remaining]');
        var statusEl = $('[data-nx-wd-status]');
        var titleEl = $('[data-nx-wd-status-title]');
        var textEl = $('[data-nx-wd-status-text]');

        if (balEl) balEl.textContent = money(total);
        var p = Math.min(100, (total / CONST.WITHDRAW_THRESHOLD) * 100);
        if (pctEl) pctEl.textContent = Math.floor(p) + '%';
        if (fillEl) fillEl.style.width = p + '%';

        if (total < CONST.WITHDRAW_THRESHOLD) {
            var remain = CONST.WITHDRAW_THRESHOLD - total;
            if (remainEl) remainEl.textContent = money(remain) + ' remaining to unlock withdrawals.';
            if (statusEl) { statusEl.style.borderLeftColor = '#e07c2c'; }
            if (titleEl) { titleEl.textContent = '🔒 Withdrawal Locked'; titleEl.style.color = '#d7771f'; }
            if (textEl) textEl.textContent = 'Keep earning from sponsored calls until you reach ₦15,000.';
        } else {
            if (remainEl) remainEl.textContent = 'Withdrawal threshold reached.';
            if (statusEl) { statusEl.style.borderLeftColor = '#2fbf71'; }
            if (titleEl) { titleEl.textContent = '✓ Withdrawal Available'; titleEl.style.color = '#2fbf71'; }
            if (textEl) textEl.textContent = "You've reached the withdrawal threshold. You can now continue.";
        }
    }

    function renderWithdrawHistoryInline() {
        var box = $('[data-nx-wd-history]');
        if (!box) return;
        var list = withdrawals();
        if (!list.length) {
            box.innerHTML = '<p class="font-sans text-muted text-[13px] text-center py-6">No withdrawals yet</p>';
            return;
        }
        box.innerHTML = list.map(function (item) {
            return '' +
                '<div class="bg-surface rounded-[18px] p-4 border border-black/[0.04]">' +
                    '<div class="flex items-center justify-between mb-2">' +
                        '<span class="font-heading font-semibold text-[15px] text-primary">Daily Earnings</span>' +
                        '<span class="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-sans text-[11px] font-semibold">' + item.status + '</span>' +
                    '</div>' +
                    '<div class="flex items-center justify-between">' +
                        '<span class="font-heading font-bold text-[20px] text-primary">-' + money(item.amount) + '</span>' +
                        '<span class="font-sans text-[12px] text-muted">' + item.date + ' · ' + item.time + '</span>' +
                    '</div>' +
                '</div>';
        }).join('');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    /* ====================================================================
     * PUBLIC API
     * ==================================================================== */
    window.NextelTasks = {
        isActive: isActive,
        activate: function () { setActive(true); refreshAll(); },
        earnings: earnings,
        balance: earnings,
        addEarnings: function (n) { addEarnings(n); refreshAll(); },
        setBalance: function (n) { setEarnings(n); refreshAll(); },
        formatMoney: money,
        refresh: refreshAll,
        constants: CONST,
        startCall: startCall,
        showFavPopup: showFavPopup,
        showVerify: showVerify,
        showGate: showGate,
        showEsimModal: showEsimModal,
        withdrawals: withdrawals,
        favorites: favorites,
        callHistory: function () { return callData().history; }
    };
})();
