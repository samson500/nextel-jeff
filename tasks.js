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
                <p>Your account is currently locked. You must purchase an E-SIM plan to activate your account before you can start making premium line calls, adding your local bank details, or running withdrawals.</p>
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
                if (earnings() < CONST.WITHDRAW_THRESHOLD) {
                    showWithdrawLockedPopup();
                    return;
                }
                // On transactions page, show inline verify section
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
                runAiCallTask();
            } else if (t.hasAttribute('data-nx-task-line')) {
                runLineCallTask();
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
        } else if (isEditProfile) {
            document.body.appendChild(buildInactiveFab());
            wireEvents();
            initFabDrag();
            updateFabVisibility();
            personaliseProfile();
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
