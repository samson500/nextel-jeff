/*
 * Nextel Connect — static clone runtime
 * ---------------------------------------------------------------
 * One file powers the whole local-only experience:
 *
 *   • Disarms Laravel Livewire (no server needed)
 *   • Provides a localStorage-backed data layer (users, session,
 *     balances, transactions, claims, settings, messages)
 *   • Wires every form via [data-auth] / wire:submit / data-action
 *   • Wires every button via [data-action="…"] (claim, claimAll,
 *     setFilter, showDetails, switchTo, save, etc.)
 *   • Personalises every page with the logged-in user's data
 *
 * Include on every page:
 *   <script src="<root-relative>auth.js" defer></script>
 *
 * The page picks behaviour from <body data-auth="…">:
 *   login       → wire login form
 *   register    → wire register form
 *   protected   → redirect to /auth/login.html if no session
 *
 * Beyond that, *all* forms with a submit action and *all* elements
 * with [data-action] are auto-wired regardless of data-auth.
 */

(function () {
    'use strict';

    /* ====================================================================
     * 1. STORAGE LAYER
     * ==================================================================== */

    var K = {
        USERS:        'nx_users',         // [{…user, password}]
        SESSION:      'nx_session',       // {…user, loginAt}
        TX:           'nx_transactions',  // [{id, type, label, amount, wallet, status, ts, details}]
        CLAIMS:       'nx_claims',        // [txId] claimed transaction IDs
        BALANCE_HIDE: 'nx_hide_balance',  // bool
        SETTINGS:     'nx_settings',      // {currency, pin, …per-user}
        TOKENS:       'nx_copied_tokens', // [token]
        MESSAGES:     'nx_messages'       // [{id, from, preview, ts, read}]
    };

    function get(key, fallback) {
        try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
        catch (_) { return fallback; }
    }
    function set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
    function unset(key) { localStorage.removeItem(key); }

    var store = {
        // Users
        users:   function () { return get(K.USERS, []); },
        addUser: function (u) { var l = store.users(); l.push(u); set(K.USERS, l); return u; },
        findUser:function (test) { return store.users().filter(test)[0] || null; },

        // Session
        session: function () { return get(K.SESSION, null); },
        login:   function (u) { set(K.SESSION, Object.assign({}, u, { loginAt: Date.now() })); },
        logout:  function () { unset(K.SESSION); },

        // Transactions
        txs:     function () { return get(K.TX, []); },
        addTx:   function (t) {
            var tx = Object.assign({ id: uid(), ts: Date.now(), status: 'completed' }, t);
            var l = store.txs(); l.unshift(tx); set(K.TX, l); return tx;
        },
        updateTx:function (id, patch) {
            var l = store.txs().map(function (t) { return t.id === id ? Object.assign(t, patch) : t; });
            set(K.TX, l);
        },
        findTx:  function (id) { return store.txs().filter(function (t) { return t.id === id; })[0] || null; },

        // Claims
        claims:    function () { return get(K.CLAIMS, []); },
        isClaimed: function (txId) { return store.claims().indexOf(txId) !== -1; },
        markClaimed:function (txId) {
            var c = store.claims(); if (c.indexOf(txId) === -1) { c.push(txId); set(K.CLAIMS, c); }
        },

        // Settings
        settings: function () { return get(K.SETTINGS, { currency: 'NGN', rate: 1, symbol: '₦' }); },
        saveSettings: function (patch) { set(K.SETTINGS, Object.assign(store.settings(), patch)); },

        // Misc
        balanceHidden: function (v) {
            if (v === undefined) return get(K.BALANCE_HIDE, false);
            set(K.BALANCE_HIDE, !!v);
        },
        addCopiedToken: function (tok) {
            var l = get(K.TOKENS, []); if (l.indexOf(tok) === -1) { l.unshift(tok); set(K.TOKENS, l.slice(0, 50)); }
        }
    };

    function uid() { return 'nx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
    function money(n) {
        var s = store.settings();
        var rate = s.rate || 1, sym = s.symbol || '₦';
        return sym + Math.round(n * rate).toLocaleString();
    }

    /* ====================================================================
     * 2. SEED DATA (only on first run)
     * ==================================================================== */

    function seed() {
        if (get('nx_seeded', false)) return;
        set('nx_seeded', true);
    }

    /* ====================================================================
     * 3. UTIL
     * ==================================================================== */

    var scriptTag = document.currentScript;
    function scriptSrc() { return scriptTag ? (scriptTag.src || '') : ''; }
    function computeRoot() {
        var a = document.createElement('a'); a.href = scriptSrc();
        var p = a.pathname.replace(/\/auth\.js(\?.*)?$/, '/');
        if (!p.endsWith('/')) p += '/';
        return p;
    }
    var ROOT = computeRoot();
    function url(path) { return ROOT + path.replace(/^\//, ''); }
    function loginUrl() { return url('auth/login.html'); }
    function dashUrl()  { return url('dashboard.html'); }

    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
    function val(ctx, name) {
        var el = ctx.querySelector('[data-model="' + name + '"]');
        if (!el) return '';
        return (el.value != null ? el.value : el.textContent || '').trim();
    }
    function isChecked(ctx, name) {
        var el = ctx.querySelector('[data-model="' + name + '"]');
        return !!(el && el.checked);
    }

    function toast(msg, type) {
        type = type || 'success';
        var colors = { success: 'bg-success/10 text-success', error: 'bg-danger/10 text-danger', info: 'bg-primary/10 text-primary' };
        var box = document.createElement('div');
        box.className = 'fixed top-4 inset-x-0 z-[200] mx-auto w-[90%] max-w-sm rounded-[14px] px-4 py-3 font-sans text-[14px] shadow-lg ' + (colors[type] || colors.success);
        box.textContent = msg;
        document.body.appendChild(box);
        setTimeout(function () { box.style.transition = 'opacity .3s'; box.style.opacity = '0'; setTimeout(function () { box.remove(); }, 300); }, 2500);
    }

    /* ====================================================================
     * 4. DISARM LIVEWIRE (but keep Alpine!)
     * ====================================================================
     * Livewire.min.js bundles Alpine core. We need Alpine for all the
     * x-data / x-show / @click directives across the site, so we can NOT
     * just delete the script. Instead, we:
     *   1. Let the script load normally (it sets window.Alpine + boots).
     *   2. Strip every wire:* attribute so Livewire has nothing to wire.
     *   3. Stub out window.Livewire's networking the moment it appears.
     */

    var _livewireStubbed = false;
    function stubLivewire() {
        if (_livewireStubbed) return;
        var L = window.Livewire;
        if (!L) return;
        _livewireStubbed = true;
        // Neutralise every method that triggers a network request.
        try {
            if (L.find)  L.find  = function () { return stubComponent(); };
            if (L.first) L.first = function () { return stubComponent(); };
            if (L.navigate) L.navigate = function (url) { if (url) location.href = url; };
            if (L.dispatch) L.dispatch = function () {};
            if (L.hook)   L.hook   = function () {};
            if (L.on)     L.on     = function () {};
        } catch (_) {}
    }
    function stubComponent() {
        return {
            $call: function () {}, $set: function () {}, $toggle: function () {},
            entangle: function () { return { get: function () { return null; }, set: function () {} }; },
            $commit: function () {}, $refresh: function () {}
        };
    }

    function disarmLivewire() {
        // DO NOT remove the Livewire script — it bundles Alpine core.
        // We'll stub Livewire's networking after it loads instead.
        // 1) Remove pure loading indicators (spinner + "Please wait…").
        $all('[wire\\:loading]').forEach(function (el) {
            if (!el.hasAttribute('wire:loading.remove') &&
                !el.hasAttribute('wire:loading.delay')) {
                el.remove();
            }
        });
        // 2) Migrate wire:model → data-model so we can still find fields.
        $all('[wire\\:model]').forEach(function (el) {
            var m = el.getAttribute('wire:model') || '';
            m = m.split('.')[0];
            el.setAttribute('data-model', m);
        });
        // 3) Migrate wire:click → data-action.
        $all('[wire\\:click]').forEach(function (el) {
            el.setAttribute('data-action', el.getAttribute('wire:click'));
        });
        // 4) Migrate wire:submit → data-action on the form.
        $all('form[wire\\:submit]').forEach(function (el) {
            el.setAttribute('data-action', el.getAttribute('wire:submit'));
        });
        // 5) Strip all remaining wire:* attributes.
        $all('*').forEach(function (el) {
            var attrs = el.attributes;
            for (var i = attrs.length - 1; i >= 0; i--) {
                if (/^wire:/.test(attrs[i].name)) el.removeAttribute(attrs[i].name);
            }
        });
        // 6) Stub Livewire ASAP. Try now, and again on alpine:init.
        stubLivewire();
        document.addEventListener('alpine:init', stubLivewire);
    }

    /* ====================================================================
     * 5. LOGOUT (all pages)
     * ==================================================================== */

    function wireLogout() {
        $all('form').forEach(function (form) {
            var action = form.getAttribute('action') || '';
            if (/#logout/i.test(action) || /\/logout/i.test(action)) {
                form.addEventListener('submit', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    store.logout();
                    window.location.href = loginUrl();
                }, true);
            }
        });
    }

    /* ====================================================================
     * 6. FORM HANDLERS
     * ==================================================================== */

    function showError(form, msg) {
        form.querySelectorAll('[data-auth-error]').forEach(function (n) { n.remove(); });
        var box = document.createElement('div');
        box.className = 'w-full rounded-[12px] bg-danger/10 text-danger px-4 py-3 font-sans text-[13px]';
        box.setAttribute('data-auth-error', '');
        box.textContent = msg;
        form.insertBefore(box, form.firstChild);
    }

    function wireLogin() {
        var form = $('form[data-action="authenticate"]') || $('form');
        if (!form) return;
        form.addEventListener('submit', function (e) {
            e.preventDefault(); e.stopPropagation();
            var id = val(form, 'login'), pw = val(form, 'password');
            if (!id || !pw) return showError(form, 'Please enter your email/username and password.');

            var u = store.findUser(function (x) {
                return (x.email && x.email.toLowerCase() === id.toLowerCase()) ||
                       (x.username && x.username.toLowerCase() === id.toLowerCase());
            });
            // Demo fallback
            if (!u && id.toLowerCase() === 'demo' && pw === 'demo1234') {
                u = { fullName: 'Demo User', username: 'demo', email: 'demo@nextel.local', phone: '', country: '' };
            }
            if (!u) return showError(form, 'No account found for "' + id + '". Please register first.');
            if (u.password && u.password !== pw && !(id.toLowerCase() === 'demo')) {
                return showError(form, 'Incorrect password. Please try again.');
            }
            store.login(u);
            var bounce = sessionStorage.getItem('nx_redirect');
            if (bounce) { sessionStorage.removeItem('nx_redirect'); window.location.href = bounce; }
            else window.location.href = dashUrl();
        }, true);
    }

    function wireRegister() {
        var form = $('form[data-action="register"]') || $('form');
        if (!form) return;
        form.addEventListener('submit', function (e) {
            e.preventDefault(); e.stopPropagation();
            var fullName = val(form, 'fullName'),
                email    = val(form, 'email'),
                username = val(form, 'username'),
                phone    = val(form, 'phone'),
                country  = val(form, 'country'),
                password = val(form, 'password'),
                confirm  = val(form, 'password_confirmation'),
                agree    = isChecked(form, 'agreeTerms');

            if (!fullName || !email || !username || !phone || !password) {
                return showError(form, 'Please fill in all required fields.');
            }
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                return showError(form, 'Please enter a valid email address.');
            }
            if (password !== confirm) {
                return showError(form, 'Passwords do not match.');
            }
            if (!agree) return showError(form, 'You must agree to the Terms & Conditions to continue.');

            if (store.findUser(function (x) {
                return x.email.toLowerCase() === email.toLowerCase() ||
                       x.username.toLowerCase() === username.toLowerCase();
            })) return showError(form, 'An account with this email or username already exists.');

            var u = { fullName: fullName, email: email, username: username,
                      phone: phone, country: country,
                      password: password };
            store.addUser(u);
            store.login(u);
            // Welcome bonus
            store.addTx({ label: 'Sign-up bonus', amount: 10000, wallet: 'referral_bonus', type: 'earn' });
            window.location.href = dashUrl();
        }, true);
    }

    function wireForgotPassword() {
        var form = $('form[data-action="sendReset"]') || $('form');
        if (!form) return;
        form.addEventListener('submit', function (e) {
            e.preventDefault(); e.stopPropagation();
            var email = val(form, 'email');
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                return showError(form, 'Please enter a valid email.');
            }
            toast('If that email exists, a reset link has been sent.');
            setTimeout(function () { window.location.href = loginUrl(); }, 1500);
        }, true);
    }

    function wireVerifyToken() {
        var form = $('form[data-action="verify"]');
        if (!form) return;
        form.addEventListener('submit', function (e) {
            e.preventDefault(); e.stopPropagation();
            var code = val(form, 'code');
            if (!code) return showError(form, 'Please enter your token.');
            toast('Token verified successfully.');
            setTimeout(function () { window.location.href = url('agents.html'); }, 1500);
        }, true);
    }

    function wireContact() {
        var form = $('form[data-action="submit"]');
        if (!form) return;
        form.addEventListener('submit', function (e) {
            e.preventDefault(); e.stopPropagation();
            if (!val(form, 'name') || !val(form, 'email') || !val(form, 'message')) {
                return showError(form, 'Please complete all fields.');
            }
            toast('Message sent. We will be in touch shortly.');
            form.reset();
        }, true);
    }

    function wireChangePin() {
        var form = $('form[data-action="proceed"]');
        if (!form) return;
        form.addEventListener('submit', function (e) {
            e.preventDefault(); e.stopPropagation();
            var cur = val(form, 'currentPin'), neu = val(form, 'newPin'), conf = val(form, 'confirmPin');
            var s = store.settings();
            if (s.pin && cur !== s.pin) return showError(form, 'Current PIN is incorrect.');
            if (!/^\d{4}$/.test(neu)) return showError(form, 'New PIN must be 4 digits.');
            if (neu !== conf) return showError(form, 'PINs do not match.');
            store.saveSettings({ pin: neu });
            toast('PIN changed successfully.');
            form.reset();
        }, true);
    }

    function wireResetPin() {
        var form = $('form[data-action="proceed"]');
        if (!form) return;
        form.addEventListener('submit', function (e) {
            e.preventDefault(); e.stopPropagation();
            var token = val(form, 'token'), neu = val(form, 'newPin'), conf = val(form, 'confirmPin');
            if (!token) return showError(form, 'Please enter the token from your email.');
            if (!/^\d{4}$/.test(neu)) return showError(form, 'New PIN must be 4 digits.');
            if (neu !== conf) return showError(form, 'PINs do not match.');
            store.saveSettings({ pin: neu });
            toast('PIN reset successfully.');
            setTimeout(function () { window.location.href = loginUrl(); }, 1500);
        }, true);
    }

    function wireSaveSettings(action) {
        // Generic save handler used by profile/edit, payment-settings,
        // change-password, rewards.saveCustom, etc.
        $all('form[data-action="' + action + '"]').forEach(function (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault(); e.stopPropagation();
                var s = store.session() || {};
                // Collect every [data-model] in this form.
                var patch = {};
                $all('[data-model]', form).forEach(function (el) {
                    var name = el.getAttribute('data-model');
                    patch[name] = el.value;
                });
                // Persist into the session and the matching user record.
                if (action === 'save' && form.querySelector('[data-model="first_name"]')) {
                    // Profile edit
                    var newUser = Object.assign({}, s, {
                        fullName: (patch.first_name || '') + ' ' + (patch.last_name || ''),
                        phone: patch.phone || s.phone,
                        telegram: patch.telegram,
                        biography: patch.biography
                    });
                    store.login(newUser);
                    updateUsersRecord(newUser);
                } else if (action === 'save' && form.querySelector('[data-model="current_password"]')) {
                    // Change password
                    if (patch.current_password !== (s.password || '')) {
                        return showError(form, 'Current password is incorrect.');
                    }
                    if (patch.password !== patch.password_confirmation) {
                        return showError(form, 'Passwords do not match.');
                    }
                    var updated = Object.assign({}, s, { password: patch.password });
                    store.login(updated);
                    updateUsersRecord(updated);
                } else if (action === 'save' && form.querySelector('[data-model="bankId"]')) {
                    store.saveSettings({ bankId: patch.bankId });
                }
                toast('Saved successfully.');
            }, true);
        });
    }

    function wireRewardCustom() {
        $all('[data-action="saveCustom"]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                var input = el.closest('div').querySelector('input[type="number"]');
                if (input) {
                    store.saveSettings({ customRewardTarget: parseFloat(input.value) || 0 });
                    toast('Custom reward target saved.');
                }
            }, true);
        });
    }

    function updateUsersRecord(patch) {
        var list = store.users().map(function (u) {
            return (u.email === patch.email || u.username === patch.username) ? Object.assign({}, u, patch) : u;
        });
        set(K.USERS, list);
    }

    /* ====================================================================
     * 7. ACTION BUTTONS  (data-action="…")
     * ==================================================================== */

    function wireActions() {
        document.addEventListener('click', function (e) {
            var el = e.target.closest('[data-action]');
            if (!el) return;
            var action = el.getAttribute('data-action') || '';
            var parts = action.match(/^(\w+)(?:\((.*)\))?$/);
            if (!parts) return;
            var name = parts[1];
            var arg  = parts[2] ? parts[2].replace(/^['"]|['"]$/g, '') : null;

            switch (name) {
                case 'claim':       doClaim(el, arg); break;
                case 'claimAll':    doClaimAll(el);   break;
                case 'setFilter':   doFilter(el, arg); break;
                case 'switchTo':    doSwitchCurrency(el, arg); break;
                case 'showDetails': doShowDetails(el, arg); break;
                case 'showMember':  toast('Member profile'); break;
                case 'viewToken':   doCopyToken(el, arg); break;
                case 'startChat':   toast('Opening chat…'); break;
                case 'addNumber':   toast('Number added to your Cloud plan.'); break;
                case 'nextPage':    toast('No more results.'); break;
                case 'selectTab':   doTab(el, arg); break;
                case 'openGenerate':toast('Generation started.'); break;
                case 'startRequest':toast('Request submitted.'); break;
                case 'apply':       toast('Application submitted.'); break;
                case 'nextelCopy':  break; // handled by dedicated listener
                // `save`/`saveCustom` handled on form/click separately.
            }
        }, true);
    }

    function doClaim(el, txId) {
        // The earnings page lists transactions server-side; we treat each
        // claim button as a fresh +$1.40 earn.
        if (txId && store.isClaimed(txId)) {
            el.disabled = true;
            el.classList.add('opacity-50');
            toast('Already claimed.', 'info');
            return;
        }
        var amt = 1028;
        var tx = store.addTx({ label: 'Claimed earning', amount: amt, wallet: 'total', type: 'earn' });
        if (txId) store.markClaimed(txId);
        if (el.tagName === 'BUTTON') {
            el.disabled = true;
            el.textContent = 'Claimed';
            el.classList.add('opacity-50');
        }
        toast('Claimed ' + money(amt) + ' successfully.');
        bumpBalance('total', amt);
        bumpBalance('lifetime', amt);
    }

    function doClaimAll(el) {
        var count = 0, total = 0;
        $all('[data-action^="claim("]').forEach(function (btn) {
            var id = (btn.getAttribute('data-action').match(/claim\(['"]([^'"]+)/) || [])[1];
            if (id && !store.isClaimed(id) && !btn.disabled) {
                store.markClaimed(id);
                store.addTx({ label: 'Claimed earning', amount: 1028, wallet: 'total', type: 'earn' });
                btn.disabled = true; btn.textContent = 'Claimed'; btn.classList.add('opacity-50');
                count++; total += 1.40;
            }
        });
        if (count === 0) { toast('Nothing to claim.', 'info'); return; }
        toast('Claimed ' + count + ' earnings (' + money(total) + ').');
        bumpBalance('total', total);
        bumpBalance('lifetime', total);
    }

    function doFilter(el, filter) {
        // Visually toggle active state on sibling buttons.
        var group = el.parentElement;
        $all('button', group).forEach(function (b) { b.classList.remove('bg-primary','text-surface'); b.classList.add('bg-surface'); });
        el.classList.add('bg-primary','text-surface'); el.classList.remove('bg-surface');
        // Filter transaction rows by data-tx-type if present.
        $all('[data-tx-type]').forEach(function (row) {
            var t = row.getAttribute('data-tx-type');
            row.style.display = (filter === 'all' || t === filter) ? '' : 'none';
        });
        toast('Filtering: ' + filter, 'info');
    }

    function doSwitchCurrency(el, cur) {
        var rates = { USD: { rate: 1, symbol: '$' }, NGN: { rate: 1, symbol: '₦' } };
        var r = rates[cur] || rates.USD;
        store.saveSettings(r);
        // Update every displayed amount tagged [data-money].
        $all('[data-money]').forEach(function (node) {
            var base = parseFloat(node.getAttribute('data-money'));
            if (!isNaN(base)) node.textContent = (r.symbol) + (base * r.rate).toFixed(2);
        });
        // Close the dropdown if Alpine is managing it.
        var dropdown = el.closest('[x-data]');
        if (dropdown && dropdown._x_dataStack) {
            try { dropdown._x_dataStack[0].open = false; } catch (_) {}
        }
        toast('Switched to ' + cur, 'info');
    }

    function doShowDetails(el, txId) {
        // Toggle a details panel below the row.
        var row = el.closest('[data-tx-type]') || el.closest('div');
        if (!row) return;
        var panel = row.querySelector('[data-detail-panel]');
        if (panel) { panel.style.display = panel.style.display === 'none' ? '' : 'none'; return; }
        var tx = store.findTx(txId) || { label: 'Transaction', amount: 0, status: 'completed' };
        panel = document.createElement('div');
        panel.setAttribute('data-detail-panel', '');
        panel.className = 'mt-3 rounded-[12px] bg-surface p-4 font-sans text-[13px] text-text';
        panel.innerHTML =
            '<div class="flex justify-between mb-2"><span class="text-muted">Reference</span><span class="font-mono">' + tx.id + '</span></div>' +
            '<div class="flex justify-between mb-2"><span class="text-muted">Description</span><span>' + (tx.label || '') + '</span></div>' +
            '<div class="flex justify-between mb-2"><span class="text-muted">Amount</span><span>' + money(tx.amount) + '</span></div>' +
            '<div class="flex justify-between"><span class="text-muted">Status</span><span class="text-success capitalize">' + tx.status + '</span></div>';
        row.appendChild(panel);
    }

    function doCopyToken(el, token) {
        store.addCopiedToken(token);
        if (navigator.clipboard) navigator.clipboard.writeText(token);
        var label = el.querySelector('span');
        var original = label ? label.textContent : '';
        if (label) label.textContent = 'Copied!';
        setTimeout(function () { if (label) label.textContent = original; }, 1500);
    }

    function doTab(el, tab) {
        var group = el.parentElement;
        $all('button, a', group).forEach(function (b) {
            b.classList.remove('bg-white/15','text-secondary'); b.classList.add('text-white/80');
        });
        el.classList.add('bg-white/15','text-secondary'); el.classList.remove('text-white/80');
    }

    /* ====================================================================
     * 8. BALANCE RENDERING
     * ==================================================================== */

    // Compute balances from session + transactions.
    function computeBalances() {
        var txs = store.txs();
        var wallets = { lifetime: 0, total: 0, shareholder: 0, ads_revenue: 0,
                        referral_bonus: 0, reward: 0, cloud_call: 0, cloud_sms: 0 };
        txs.forEach(function (t) {
            if (t.type !== 'earn') return;
            var w = t.wallet || 'total';
            if (wallets[w] != null) wallets[w] += t.amount;
            if (w !== 'lifetime') wallets.lifetime += t.amount;
        });
        return [
            { label: 'Total Balance',   amount: wallets.lifetime,      wallet: 'lifetime',        exact: wallets.lifetime },
            { label: 'Current Balance', amount: wallets.total,         wallet: 'total',           exact: wallets.total,  today: 0 },
            { label: 'Nextel Shares',   amount: wallets.shareholder,   wallet: 'shareholder',     exact: wallets.shareholder, today: 0 },
            { label: 'Ads Revenue',     amount: wallets.ads_revenue,   wallet: 'ads_revenue',     exact: wallets.ads_revenue, today: 0 },
            { label: 'Connect Bonus',   amount: wallets.referral_bonus,wallet: 'referral_bonus',  exact: wallets.referral_bonus, today: 0 },
            { label: 'Target Reward',   amount: wallets.reward,        wallet: 'reward',          exact: wallets.reward, today: 0 },
            { label: 'N-Cloud Calls',   amount: wallets.cloud_call,    wallet: 'cloud_call',      exact: wallets.cloud_call, today: 0 },
            { label: 'N-Cloud SMS',     amount: wallets.cloud_sms,     wallet: 'cloud_sms',       exact: wallets.cloud_sms, today: 0 }
        ];
    }

    function bumpBalance(wallet, delta) {
        // Force a re-render of any balance widget on the page.
        renderBalances();
    }

    // Post-boot balance refresh. Called after a claim / addTx when Alpine
    // is already up. Pokes each balance widget's reactive data.
    function renderBalances() {
        var live = computeBalances().map(function (b) {
            return {
                label:  b.label,
                amount: money(b.amount),
                exact:  money(b.exact),
                today:  b.today != null ? money(b.today) : null,
                wallet: b.wallet
            };
        });
        $all('[x-data]').forEach(function (el) {
            // Skip elements that don't carry a balances array.
            var src = el.getAttribute('x-data') || '';
            if (!/balances\s*:/.test(src) && !el._x_dataStack) return;
            if (!el._x_dataStack) return;
            try {
                var data = el._x_dataStack[0];
                if (data && Array.isArray(data.balances)) {
                    // Mutate in place so Alpine's reactivity catches it
                    data.balances.length = 0;
                    live.forEach(function (b) { data.balances.push(b); });
                    if (data.i >= live.length) data.i = 0;
                }
            } catch (_) {}
        });
    }

    /* ====================================================================
     * 9. PROTECTED PAGES — guard + personalise
     * ==================================================================== */

    function guard() {
        var s = store.session();
        if (!s) {
            try { sessionStorage.setItem('nx_redirect', window.location.pathname + window.location.hash); } catch (_) {}
            window.location.replace(loginUrl());
            return;
        }
        personalise(s);
        renderBalances();
        renderTransactions();
    }

    function personalise(user) {
        var first = (user.fullName || '').split(/\s+/)[0] || user.username || 'there';
        // "Hi, Bobby" on dashboard
        $all('p.font-heading.font-medium.truncate').forEach(function (p) {
            if (/^Hi,/.test(p.textContent)) p.textContent = 'Hi, ' + first;
        });
        // Sidebar name
        $all('.block.font-heading.font-medium.text-white').forEach(function (p) {
            if (/Bobby Emmanuel/.test(p.textContent)) p.textContent = user.fullName || 'Bobby Emmanuel';
        });
        // Sidebar email/plan caption
        $all('.block.font-sans.text-white\\/55').forEach(function (p) {
            if (/Royal eSIM/.test(p.textContent)) p.textContent = user.email || user.username || '';
        });
        // Profile page bio/name fields
        setInput('[data-model="first_name"]',  (user.fullName || '').split(/\s+/)[0]);
        setInput('[data-model="last_name"]',   (user.fullName || '').split(/\s+/).slice(1).join(' '));
        setInput('[data-model="phone"]',       user.phone || '');
        // Profile page custom fields (data-nx-*)
        var avatar = document.querySelector('[data-nx-avatar]');
        if (avatar) avatar.textContent = (user.fullName || 'U').charAt(0).toUpperCase();
        var fullNameEl = document.querySelector('[data-nx-fullname]');
        if (fullNameEl) fullNameEl.textContent = user.fullName || 'User';
        var userInfoEl = document.querySelector('[data-nx-userinfo]');
        if (userInfoEl) userInfoEl.textContent = '@' + (user.username || 'user') + (user.email ? ' · ' + user.email : '');
        var unameDisplay = document.querySelector('[data-model="username-display"]');
        if (unameDisplay) unameDisplay.textContent = '@' + (user.username || 'user');
        var emailDisplay = document.querySelector('[data-model="email-display"]');
        if (emailDisplay) emailDisplay.textContent = user.email || '';
        // Referral code badge (COACHRUTH etc.)
        $all('[data-ref-code]').forEach(function (n) {
            n.textContent = (user.username || 'USER').toUpperCase();
        });
        // Invite page referral link
        $all('[data-ref-link]').forEach(function (n) {
            n.textContent = url('auth/register.html?ref=' + (user.username || '').toUpperCase());
        });
    }

    function setInput(sel, value) {
        var el = $(sel); if (el && el.value !== undefined && !el.value) el.value = value || '';
    }

    // Render the recent-transactions list on dashboard/transactions pages.
    function renderTransactions() {
        var lists = $all('[data-tx-list]');
        if (!lists.length) return;
        var txs = store.txs().slice(0, 50);
        var html = txs.map(function (t) {
            var isEarn = t.type === 'earn';
            var color = isEarn ? 'success' : 'text';
            var icon  = isEarn ? 'ri-user-add-line' : 'ri-arrow-up-line';
            var sign  = isEarn ? '+' : '−';
            var date  = new Date(t.ts).toLocaleString(undefined, {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: 'numeric', minute: '2-digit'
            });
            return '' +
              '<div data-tx-type="' + t.type + '" data-action="showDetails(\'' + t.id + '\')" ' +
                   'class="flex items-center gap-2.5 px-2.5 py-2.5 cursor-pointer rounded-[14px] hover:bg-background/60 transition-colors border-b border-muted/10">' +
                '<span class="size-[45px] rounded-full flex items-center justify-center shrink-0 bg-' + color + '/15 text-' + color + '">' +
                  '<i class="' + icon + ' text-[19px]"></i>' +
                '</span>' +
                '<div class="flex-1 min-w-0 flex flex-col">' +
                  '<p class="font-sans font-semibold text-[14px] text-' + color + '">' + sign +
                    '<span>' + money(t.amount) + '</span>' +
                  '</p>' +
                  '<p class="font-sans text-muted text-[12px] truncate">' + (t.label || '') + '</p>' +
                '</div>' +
                '<div class="flex flex-col items-end shrink-0 text-right">' +
                  '<p class="font-sans text-[12px] capitalize text-' + color + '">' + (t.status || 'completed') + '</p>' +
                  '<p class="font-sans text-muted text-[10px]">' + date + '</p>' +
                '</div>' +
              '</div>';
        }).join('') || '<p class="font-sans text-muted text-[13px] py-4 text-center">No transactions yet.</p>';

        lists.forEach(function (list) { list.innerHTML = html; });
    }

    /* ====================================================================
     * 10. CLIPBOARD HELPER (invite + agent batch pages)
     * ==================================================================== */

    // Expose nextelCopy as a global so existing @click="nextelCopy('X')"
    // handlers work without modification.
    window.nextelCopy = function (text) {
        return new Promise(function (resolve) {
            store.addCopiedToken(text);
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(false); });
            } else {
                var ta = document.createElement('textarea');
                ta.value = text; document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); resolve(true); } catch (_) { resolve(false); }
                ta.remove();
            }
        });
    };

    /* ====================================================================
     * 11. BOOT
     * ==================================================================== */

    // EARLY PASS — runs immediately while the parser is in <body>.
    // Critical: must complete BEFORE Alpine boots (DOMContentLoaded) so
    // that Livewire is disarmed and balance JSON is rewritten in time.
    function earlyBoot() {
        seed();
        disarmLivewire();
        // Expose NexAuth early so inline Alpine x-data expressions can
        // reference NexAuth.balances() if present.
        if (!window.NexAuth) {
            window.NexAuth = {
                store: store, money: money,
                balances: computeBalances,
                renderBalances: function () { renderBalances(); },
                renderTransactions: function () { renderTransactions(); },
                session: store.session, users: store.users, txs: store.txs,
                logout: function () { store.logout(); window.location.href = loginUrl(); },
                loginDemo: function () {
                    var u = { fullName: 'Demo User', username: 'demo', email: 'demo@nextel.local', phone: '+1 555 0000', country: 'US' };
                    store.login(u);
                    window.location.href = dashUrl();
                },
                reset: function () {
                    Object.keys(K).forEach(function (k) { localStorage.removeItem(K[k]); });
                    localStorage.removeItem('nx_seeded');
                    location.reload();
                },
                addTx: function (label, amount, wallet, type) {
                    store.addTx({ label: label, amount: amount, wallet: wallet, type: type || 'earn' });
                    renderBalances(); renderTransactions();
                }
            };
        }
        // Rewrite hardcoded balance JSON in x-data attrs.
        // Safe to call here AND on alpine:init (idempotent).
        patchBalanceAttrs();
    }

    // One-shot rewrite of every `balances: JSON.parse('[…]')` literal in
    // x-data attributes so the data sources from our store. Runs before
    // Alpine processes the elements.
    function patchBalanceAttrs() {
        $all('[x-data]').forEach(function (el) {
            var src = el.getAttribute('x-data') || '';
            if (!/balances\s*:\s*JSON\.parse\(/.test(src)) return;
            var live = JSON.stringify(computeBalances().map(function (b) {
                return {
                    label:  b.label,
                    amount: money(b.amount),
                    exact:  money(b.exact),
                    today:  b.today != null ? money(b.today) : null,
                    wallet: b.wallet
                };
            }));
            var newSrc = src.replace(
                /balances\s*:\s*JSON\.parse\([^)]*\)/,
                'balances: ' + live
            );
            if (newSrc !== src) el.setAttribute('x-data', newSrc);
        });
    }

    // Alpine fires `alpine:init` before processing any x-data. We re-patch
    // here in case our defer script ran after the Alpine module but before
    // Alpine actually starts walking the DOM.
    document.addEventListener('alpine:init', patchBalanceAttrs);

    function boot() {
        wireLogout();
        wireActions();

        var mode = document.body.getAttribute('data-auth') || '';

        switch (mode) {
            case 'login':          wireLogin(); break;
            case 'register':       wireRegister(); break;
            case 'protected':      guard(); break;
        }

        if ($('form[data-action="sendReset"]'))  wireForgotPassword();
        if ($('form[data-action="verify"]'))     wireVerifyToken();
        if ($('form[data-action="submit"]') && window.location.pathname.indexOf('contact') !== -1) wireContact();
        if ($('form[data-action="proceed"]')) {
            if ($('[data-model="token"]')) wireResetPin();
            else wireChangePin();
        }
        wireSaveSettings('save');
        wireRewardCustom();

        if (mode !== 'protected') {
            var s = store.session();
            if (s) personalise(s);
        }
    }

    // earlyBoot runs right away (we're a deferred script — DOM is parsed,
    // DOMContentLoaded has not fired, Alpine has not booted).
    earlyBoot();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    /* ====================================================================
     * 12. PUBLIC API (console)
     * ==================================================================== */

    // NexAuth is already exposed by earlyBoot(); nothing more to do here.
})();
