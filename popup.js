// ── History (localStorage) ───────────────────────────────────────────────────

const THEME_KEY        = 'trajet41_theme';
const HISTORY_KEY      = 'trajet41_history';
const HISTORY_MAX      = 15;
const LAST_MODE_KEY    = 'trajet41_lastMode';
const AUTOCOMPLETE_KEY = 'trajet41_autocomplete';
const RETOUR_STATE_KEY  = 'trajet41_retourState';
const RETOUR_MEMORY_KEY = 'trajet41_retourMemory';

function isAutocompleteEnabled() {
    return localStorage.getItem(AUTOCOMPLETE_KEY) !== 'false';
}

function isRetourMemoryEnabled() {
    return localStorage.getItem(RETOUR_MEMORY_KEY) === 'true';
}

function saveRetourState() {
    if (!isRetourMemoryEnabled()) return;
    const startInp = document.getElementById('retourStart');
    const state = {
        start: startInp.dataset.lat
            ? { value: startInp.value, lat: startInp.dataset.lat, lon: startInp.dataset.lon }
            : null,
        stops: retourStopIds.map(id => {
            const inp = document.getElementById(id);
            return inp?.dataset.lat
                ? { value: inp.value, lat: inp.dataset.lat, lon: inp.dataset.lon }
                : null;
        }).filter(Boolean),
    };
    localStorage.setItem(RETOUR_STATE_KEY, JSON.stringify(state));
}

function restoreRetourState() {
    if (!isRetourMemoryEnabled()) return;
    let state;
    try { state = JSON.parse(localStorage.getItem(RETOUR_STATE_KEY)); } catch { return; }
    if (!state) return;

    if (state.start) {
        const inp = document.getElementById('retourStart');
        inp.value = state.start.value;
        inp.dataset.lat = state.start.lat;
        inp.dataset.lon = state.start.lon;
        _clearUpdaters['retourStart']?.();
    }

    const stops = state.stops || [];
    stops.forEach((s, i) => {
        if (i >= retourStopIds.length) addRetourStop();
        const inp = document.getElementById(retourStopIds[i]);
        inp.value = s.value;
        inp.dataset.lat = s.lat;
        inp.dataset.lon = s.lon;
    });
}

function saveHistory(label, lat, lon) {
    let list = getHistory();
    list = list.filter(h => h.label !== label);
    list.unshift({ label, lat, lon });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
}

function getHistory() {
    try { return (JSON.parse(localStorage.getItem(HISTORY_KEY)) || []).slice(0, HISTORY_MAX); }
    catch { return []; }
}

function deleteHistory(label) {
    const list = getHistory().filter(h => h.label !== label);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

// ── Villes fréquentes du 41 (fallback quand historique vide) ─────────────────

const DEFAULT_CITIES = [
    { label: 'Blois, 41000',                  lat: '47.5862', lon: '1.3359' },
    { label: 'Vendôme, 41100',                lat: '47.7920', lon: '1.0657' },
    { label: 'Romorantin-Lanthenay, 41200',   lat: '47.3635', lon: '1.7495' },
    { label: 'Salbris, 41300',                lat: '47.4261', lon: '2.0502' },
    { label: 'Mer, 41500',                    lat: '47.7003', lon: '1.4997' },
    { label: 'Contres, 41700',                lat: '47.4108', lon: '1.4390' },
    { label: 'Selles-sur-Cher, 41130',        lat: '47.2774', lon: '1.5522' },
];

// ── Nominatim : rate limit (1 req/s) + cache ─────────────────────────────────

const PLACE_TYPES = ['city', 'town', 'village', 'hamlet', 'municipality', 'suburb', 'quarter'];

function placePriority(d) {
    if (d.class === 'place') return 0;
    if (PLACE_TYPES.includes(d.type)) return 1;
    if (d.address?.town || d.address?.village || d.address?.city) return 2;
    return 3;
}

function nominatimLabel(d) {
    const a = d.address || {};
    const first = d.display_name.split(',')[0].trim();
    return (/^\d/.test(first) ? null : first)
        || a.hamlet || a.suburb || a.village || a.town || a.city || a.municipality
        || first;
}

const _nominatim = {
    lastCall: 0,
    minInterval: 1100,
    cache: new Map(),
    async fetch(url) {
        if (this.cache.has(url)) return this.cache.get(url);
        const wait = Math.max(0, this.minInterval - (Date.now() - this.lastCall));
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        this.lastCall = Date.now();
        const data = await (await fetch(url)).json();
        this.cache.set(url, data);
        return data;
    }
};

function nominatimUrl(base) {
    return `${base}&email=calcul-trajet-41`;
}

const VIEWBOX = "0.70,47.15,2.25,48.20";

// ── Autocomplete ──────────────────────────────────────────────────────────────

function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function getPermutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const p of getPermutations(rest)) result.push([arr[i], ...p]);
    }
    return result;
}

const _clearUpdaters = {};

function setupAutocomplete(inputId, suggestionsId, nextInputId, onSelect, showClearBtn = true) {
    const input = document.getElementById(inputId);
    const box   = document.getElementById(suggestionsId);
    let activeIdx = -1;
    let items = [];

    let updateClearBtn = () => {};
    if (showClearBtn) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'clear-btn';
        clearBtn.title = 'Effacer';
        clearBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>`;
        input.closest('.input-row').appendChild(clearBtn);
        updateClearBtn = () => { clearBtn.style.display = input.value ? 'flex' : 'none'; };
        clearBtn.addEventListener('mousedown', e => {
            e.preventDefault();
            input.value = '';
            delete input.dataset.lat;
            delete input.dataset.lon;
            close();
            updateClearBtn();
            input.focus();
        });
    }
    _clearUpdaters[inputId] = updateClearBtn;

    function close() { box.classList.remove('open'); activeIdx = -1; }

    function highlight(idx) {
        box.querySelectorAll('.suggestion-item').forEach((el, i) => {
            el.classList.toggle('active', i === idx);
        });
    }

    function showHistory() {
        if (!isAutocompleteEnabled()) return;
        const list = getHistory();
        const displayItems = list.length
            ? list.map(h => ({ ...h, _isHistory: true }))
            : DEFAULT_CITIES.map(c => ({ ...c, _isDefault: true }));
        if (!displayItems.length) return;
        items = displayItems;
        const HIST_SVG    = `<span class="sug-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>`;
        const DEFAULT_SVG = `<span class="sug-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span>`;
        const DEL_SVG     = `<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>`;
        box.innerHTML = items.map((h, i) => `
            <div class="suggestion-item" data-idx="${i}">
                ${h._isHistory ? HIST_SVG : DEFAULT_SVG}
                <div class="sug-content">
                    <div class="sug-main">${h.label}</div>
                </div>
                ${h._isHistory
                    ? `<button class="sug-del-btn" data-label="${h.label.replace(/"/g, '&quot;')}" title="Supprimer" aria-label="Supprimer de l'historique">${DEL_SVG}</button>`
                    : ''}
            </div>
        `).join('');
        box.querySelectorAll('.suggestion-item').forEach(el => {
            el.addEventListener('mousedown', e => {
                if (e.target.closest('.sug-del-btn')) return;
                e.preventDefault();
                select(parseInt(el.dataset.idx));
            });
        });
        box.querySelectorAll('.sug-del-btn').forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                deleteHistory(btn.dataset.label);
                showHistory();
            });
        });
        box.classList.add('open');
        activeIdx = -1;
    }

    async function fetchSuggestions(query) {
        if (!isAutocompleteEnabled()) { close(); return; }
        if (query.length < 2) { close(); return; }
        try {
            const url = nominatimUrl(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&viewbox=${VIEWBOX}&bounded=1&countrycodes=fr&limit=8&addressdetails=1`);
            const data = await _nominatim.fetch(url);
            items = data
                .filter(d => (d.address?.postcode || '').startsWith('41'))
                .sort((a, b) => placePriority(a) - placePriority(b))
                .slice(0, 5);
            if (!items.length) { close(); return; }
            box.innerHTML = items.map((d, i) => {
                const a   = d.address || {};
                const main = nominatimLabel(d);
                const sub  = [a.postcode, a.county, a.state].filter(Boolean).join(', ');
                return `<div class="suggestion-item" data-idx="${i}">
                    <div class="sug-content">
                        <div class="sug-main">${main}</div>
                        ${sub ? `<div class="sug-sub">${sub}</div>` : ''}
                    </div>
                </div>`;
            }).join('');
            box.querySelectorAll('.suggestion-item').forEach(el => {
                el.addEventListener('mousedown', e => { e.preventDefault(); select(parseInt(el.dataset.idx)); });
            });
            box.classList.add('open');
            activeIdx = -1;
        } catch { close(); }
    }

    function select(idx) {
        const d = items[idx];
        if (!d) return;
        if (d._isHistory || d._isDefault) {
            input.value = d.label;
        } else {
            const a = d.address || {};
            const postcode = a.postcode ? `, ${a.postcode}` : '';
            input.value = nominatimLabel(d) + postcode;
        }
        input.dataset.lat = d.lat;
        input.dataset.lon = d.lon;
        // Flash l'input-row pour confirmer la sélection
        const row = input.closest('.input-row');
        row.classList.remove('input-flash');
        void row.offsetWidth;
        row.classList.add('input-flash');
        close();
        updateClearBtn();
        if (nextInputId) document.getElementById(nextInputId).focus();
        onSelect?.();
    }

    const debouncedFetch = debounce(fetchSuggestions, 280);

    input.addEventListener('input', () => {
        delete input.dataset.lat;
        delete input.dataset.lon;
        updateClearBtn();
        const val = input.value.trim();
        if (!val) { showHistory(); return; }
        debouncedFetch(val);
    });

    input.addEventListener('focus', () => { if (!input.value.trim()) showHistory(); });

    input.addEventListener('keydown', e => {
        if (!box.classList.contains('open')) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
            highlight(activeIdx);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
            highlight(activeIdx);
        } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.stopImmediatePropagation();
            select(activeIdx);
        } else if (e.key === 'Escape') {
            close();
        }
    });

    input.addEventListener('blur', () => setTimeout(close, 150));
}

// ── Auto-calc callbacks ───────────────────────────────────────────────────────

function triggerAutoFlash(btnId) {
    const btn = document.getElementById(btnId);
    btn.classList.remove('btn-auto-flash');
    void btn.offsetWidth;
    btn.classList.add('btn-auto-flash');
    btn.addEventListener('animationend', () => btn.classList.remove('btn-auto-flash'), { once: true });
}

function checkAndCalcSimple() {
    const s = document.getElementById('start');
    const e = document.getElementById('end');
    if (s.dataset.lat && e.dataset.lat) {
        triggerAutoFlash('calcBtn');
        calculerTrajet();
    }
}

function checkAndCalcRetour() {
    const s = document.getElementById('retourStart');
    const allReady = retourStopIds.every(id => document.getElementById(id)?.dataset.lat);
    if (s.dataset.lat && allReady && retourStopIds.length > 0) {
        triggerAutoFlash('calcRetourBtn');
        calculerRetour();
    }
}

setupAutocomplete('start',       'startSuggestions',       'end',  checkAndCalcSimple);
setupAutocomplete('end',         'endSuggestions',          null,   checkAndCalcSimple);
setupAutocomplete('retourStart', 'retourStartSuggestions',  null,   checkAndCalcRetour);

// ── Gestion des lignes RDV dynamiques (mode retour) ───────────────────────────

let retourStopIds = [];
let retourStopCounter = 0;
const MAX_STOPS = 5;

function updateStopLabels() {
    retourStopIds.forEach((id, i) => {
        const row = document.querySelector(`[data-stop-id="${id}"]`);
        if (row) row.querySelector('.field-label').textContent = retourStopIds.length > 1 ? `RDV ${i + 1}` : 'RDV potentiel';
    });
}

function updateRemoveBtns() {
    const show = retourStopIds.length > 1;
    retourStopIds.forEach(id => {
        const row = document.querySelector(`[data-stop-id="${id}"]`);
        if (row) row.querySelector('.remove-stop-btn').style.display = show ? 'flex' : 'none';
    });
}

function updateAddBtn() {
    document.getElementById('addStopBtn').style.display = retourStopIds.length >= MAX_STOPS ? 'none' : '';
}

function addRetourStop() {
    const idx = retourStopCounter++;
    const inputId = `retourStop_${idx}`;
    const sugId   = `retourStopSug_${idx}`;

    const row = document.createElement('div');
    row.className = 'input-row retour-stop-row';
    row.dataset.stopId = inputId;
    row.innerHTML = `
        <div class="autocomplete-wrap">
            <span class="field-label">RDV potentiel</span>
            <input type="text" id="${inputId}" placeholder="Ville du rendez-vous" autocomplete="off">
            <div class="suggestions" id="${sugId}"></div>
        </div>
        <button class="remove-stop-btn" title="Supprimer ce RDV" aria-label="Supprimer ce RDV" style="display:none"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg></button>
    `;
    document.getElementById('retourStopsContainer').appendChild(row);
    retourStopIds.push(inputId);

    row.querySelector('.remove-stop-btn').addEventListener('click', () => removeRetourStop(inputId));
    setupAutocomplete(inputId, sugId, null, checkAndCalcRetour, false);
    document.getElementById(inputId).addEventListener('keydown', e => { if (e.key === 'Enter') calculerRetour(); });

    updateStopLabels();
    updateRemoveBtns();
    updateAddBtn();
}

function removeRetourStop(stopId) {
    const row = document.querySelector(`[data-stop-id="${stopId}"]`);
    if (row) row.remove();
    retourStopIds = retourStopIds.filter(id => id !== stopId);
    delete _clearUpdaters[stopId];
    updateStopLabels();
    updateRemoveBtns();
    updateAddBtn();
    checkAndCalcRetour();
}

// ── Toggle historique ─────────────────────────────────────────────────────────

// ── Toggle thème clair / sombre ───────────────────────────────────────────────

const _MOON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const _SUN  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;

function getEffectiveTheme() {
    return localStorage.getItem(THEME_KEY)
        || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function updateThemeBtn() {
    const btn = document.getElementById('themeToggle');
    const isDark = getEffectiveTheme() === 'dark';
    btn.innerHTML = isDark ? _SUN : _MOON;
    btn.title = isDark ? 'Passer en mode clair' : 'Passer en mode sombre';
    btn.setAttribute('aria-label', btn.title);
}

const themeToggle = document.getElementById('themeToggle');
themeToggle.addEventListener('click', () => {
    const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.dataset.theme = next;
    updateThemeBtn();
});
updateThemeBtn();

// ── Toggle historique ─────────────────────────────────────────────────────────

const historyToggle = document.getElementById('historyToggle');
historyToggle.setAttribute('aria-checked', isAutocompleteEnabled() ? 'true' : 'false');
historyToggle.addEventListener('click', () => {
    const next = !isAutocompleteEnabled();
    localStorage.setItem(AUTOCOMPLETE_KEY, next ? 'true' : 'false');
    historyToggle.setAttribute('aria-checked', next ? 'true' : 'false');
});

const retourMemoryToggle = document.getElementById('retourMemoryToggle');
retourMemoryToggle.setAttribute('aria-checked', isRetourMemoryEnabled() ? 'true' : 'false');
retourMemoryToggle.addEventListener('click', () => {
    const next = !isRetourMemoryEnabled();
    localStorage.setItem(RETOUR_MEMORY_KEY, next ? 'true' : 'false');
    retourMemoryToggle.setAttribute('aria-checked', next ? 'true' : 'false');
});

// ── Tabs + persistance du mode ────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const isRetour = tab.dataset.tab === 'retour';
        document.getElementById('modeSimple').style.display = isRetour ? 'none' : 'block';
        document.getElementById('modeRetour').style.display = isRetour ? 'block' : 'none';
        localStorage.setItem(LAST_MODE_KEY, tab.dataset.tab);
    });
});

const _lastMode = localStorage.getItem(LAST_MODE_KEY);
if (_lastMode === 'retour') document.querySelector('[data-tab="retour"]').click();

// ── Escape → reset complet ────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['start', 'end', 'retourStart', ...retourStopIds].forEach(id => {
        const inp = document.getElementById(id);
        if (!inp) return;
        inp.value = '';
        delete inp.dataset.lat;
        delete inp.dataset.lon;
    });
    Object.values(_clearUpdaters).forEach(fn => fn());
    document.getElementById('result').style.display       = 'none';
    document.getElementById('resultRetour').style.display = 'none';
    restoreBtn('calcBtn');
    restoreBtn('calcRetourBtn');
    const activeTab = document.querySelector('.tab.active').dataset.tab;
    document.getElementById(activeTab === 'retour' ? 'retourStart' : 'start').focus();
});

// ── Actions mode simple ───────────────────────────────────────────────────────

function setBloisOnInput(inputId, nextInputId) {
    const input = document.getElementById(inputId);
    input.value = "Blois, 41000";
    input.dataset.lat = "47.5862";
    input.dataset.lon = "1.3359";
    _clearUpdaters[inputId]?.();
    if (nextInputId) document.getElementById(nextInputId).focus();
}

document.getElementById('fromBloisBtn').addEventListener('click', () => setBloisOnInput('start', 'end'));
document.getElementById('retourFromBloisBtn').addEventListener('click', () => { setBloisOnInput('retourStart', null); checkAndCalcRetour(); });

document.getElementById('swapBtn').addEventListener('click', () => {
    const s = document.getElementById('start');
    const e = document.getElementById('end');
    [s.value, e.value]             = [e.value, s.value];
    [s.dataset.lat, e.dataset.lat] = [e.dataset.lat, s.dataset.lat];
    [s.dataset.lon, e.dataset.lon] = [e.dataset.lon, s.dataset.lon];
    _clearUpdaters['start']?.();
    _clearUpdaters['end']?.();
});

document.getElementById('calcBtn').addEventListener('click', calculerTrajet);
document.getElementById('end').addEventListener('keydown',   e => { if (e.key === 'Enter') calculerTrajet(); });
document.getElementById('start').addEventListener('keydown', e => { if (e.key === 'Enter') calculerTrajet(); });

// ── Actions mode retour ───────────────────────────────────────────────────────

document.getElementById('calcRetourBtn').addEventListener('click', calculerRetour);
document.getElementById('retourStart').addEventListener('keydown', e => { if (e.key === 'Enter') calculerRetour(); });
document.getElementById('addStopBtn').addEventListener('click', addRetourStop);
addRetourStop();
restoreRetourState();

// ── Geocoding ─────────────────────────────────────────────────────────────────

async function getCoords(inputId) {
    const input = document.getElementById(inputId);
    if (input.dataset.lat && input.dataset.lon) {
        saveHistory(input.value.trim(), input.dataset.lat, input.dataset.lon);
        return { lat: input.dataset.lat, lon: input.dataset.lon };
    }
    const query = input.value.trim();
    let data;
    try {
        const url = nominatimUrl(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&viewbox=${VIEWBOX}&bounded=1&countrycodes=fr&limit=5&addressdetails=1`);
        data = await _nominatim.fetch(url);
    } catch {
        throw new Error("Service de géocodage indisponible");
    }
    const result = data?.find(d => (d.address?.postcode || '').startsWith('41'));
    if (result) {
        saveHistory(query, result.lat, result.lon);
        return { lat: result.lat, lon: result.lon };
    }
    throw new Error(`"${query}" introuvable dans le 41`);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const _btnOriginals = {};

function showLoading(resultId, btnId) {
    document.getElementById(resultId).style.display = 'none';
    const btn = document.getElementById(btnId);
    _btnOriginals[btnId] = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span>Calcul en cours…`;
}

function restoreBtn(btnId) {
    const btn = document.getElementById(btnId);
    if (_btnOriginals[btnId]) {
        btn.innerHTML = _btnOriginals[btnId];
        delete _btnOriginals[btnId];
    }
    btn.disabled = false;
}

function updateLoadingText(btnId, text) {
    const btn = document.getElementById(btnId);
    if (!btn.disabled) return;
    btn.innerHTML = `<span class="btn-spinner"></span>${text}`;
}

function flashInputError(inputId) {
    const row = document.getElementById(inputId)?.closest('.input-row');
    if (!row) return;
    row.classList.remove('input-error');
    void row.offsetWidth;
    row.classList.add('input-error');
    row.addEventListener('animationend', () => row.classList.remove('input-error'), { once: true });
}

function showError(resultId, btnId, msg) {
    restoreBtn(btnId);
    const r = document.getElementById(resultId);
    r.className = 'result-box';
    r.style.display = 'block';
    r.innerHTML = `<div class="result-error"><span class="result-error-icon">⚠️</span>${msg}</div>`;
    void r.offsetWidth;
    r.classList.add('visible');
}

function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${minutes} min`;
}

const STATUS_SVG = {
    ok:   `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5.5 3.8,7.8 8.5,2.5"/></svg>`,
    warn: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 1.5L9 8.5H1z"/><line x1="5" y1="4.5" x2="5" y2="6.2"/><circle cx="5" cy="7.4" r="0.5" fill="currentColor"/></svg>`,
    bad:  `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>`,
};

// ── Calcul mode simple ────────────────────────────────────────────────────────

async function calculerTrajet() {
    const startVal = document.getElementById('start').value.trim();
    const endVal   = document.getElementById('end').value.trim();
    if (!startVal || !endVal) {
        if (!startVal) flashInputError('start');
        if (!endVal)   flashInputError('end');
        showError('result', 'calcBtn', "Remplissez les deux champs");
        return;
    }

    showLoading('result', 'calcBtn');

    try {
        const start = await getCoords('start');
        const end   = await getCoords('end');
        updateLoadingText('calcBtn', "Calcul de l'itinéraire…");

        let routeData;
        try {
            routeData = await fetch(
                `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=false`
            ).then(r => r.json());
        } catch {
            throw new Error("Service de calcul indisponible");
        }

        if (!routeData.routes?.[0]) throw new Error("Itinéraire introuvable");

        const route = routeData.routes[0];
        const durationMin = Math.round(route.duration / 60);
        const h = Math.floor(durationMin / 60);
        const m = durationMin % 60;
        const timeVal  = h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${durationMin}`;
        const timeUnit = h > 0 ? '' : 'min';
        const distKm   = (route.distance / 1000).toFixed(1);

        const status = durationMin < 20
            ? { cls: 'status-ok',   icon: STATUS_SVG.ok,   label: 'OK pour enchaîner', title: 'Trajet < 20 min' }
            : durationMin < 35
            ? { cls: 'status-warn', icon: STATUS_SVG.warn, label: 'Limite — à voir',   title: 'Trajet entre 20 et 35 min' }
            : { cls: 'status-bad',  icon: STATUS_SVG.bad,  label: 'Trop loin',         title: 'Trajet > 35 min' };

        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(startVal)}&destination=${encodeURIComponent(endVal)}&travelmode=driving`;
        const r = document.getElementById('result');
        r.className = 'result-box';
        r.style.display = 'block';
        r.innerHTML = `
            <div class="result-success">
                <div class="result-row">
                    <div class="result-time">
                        <span class="val">${timeVal}</span>
                        <span class="unit">${timeUnit}</span>
                    </div>
                    <div class="result-dist-block">
                        <span class="val">${distKm}</span>
                        <span class="unit">km</span>
                    </div>
                </div>
                <span class="status-badge ${status.cls}" title="${status.title}">${status.icon} ${status.label}</span>
                <button class="btn-maps" id="mapsBtn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                    Voir dans Google Maps
                </button>
            </div>`;
        void r.offsetWidth;
        r.classList.add('visible');
        document.getElementById('mapsBtn').addEventListener('click', () => window.open(mapsUrl, '_blank'));
        restoreBtn('calcBtn');
    } catch (err) {
        showError('result', 'calcBtn', err.message);
    }
}

// ── Calcul mode retour Blois ──────────────────────────────────────────────────

const BLOIS = { lat: "47.5862", lon: "1.3359" };

async function calculerRetour() {
    const startVal = document.getElementById('retourStart').value.trim();
    const stopVals = retourStopIds.map(id => document.getElementById(id)?.value.trim() || '');
    if (!startVal || stopVals.some(v => !v)) {
        if (!startVal) flashInputError('retourStart');
        retourStopIds.forEach((id, i) => { if (!stopVals[i]) flashInputError(id); });
        showError('resultRetour', 'calcRetourBtn', "Remplissez tous les champs");
        return;
    }

    showLoading('resultRetour', 'calcRetourBtn');

    try {
        const posA = await getCoords('retourStart');
        const posStops = [];
        for (const id of retourStopIds) posStops.push(await getCoords(id));
        updateLoadingText('calcRetourBtn', 'Calcul des itinéraires…');

        const base        = 'https://router.project-osrm.org/route/v1/driving';
        const stopsCoords = posStops.map(p => `${p.lon},${p.lat}`).join(';');

        // Requêtes principales + routes intermédiaires pour le détail par RDV (en parallèle)
        const intermediateRequests = posStops.slice(0, -1).map((_, k) => {
            const partial = posStops.slice(0, k + 1).map(p => `${p.lon},${p.lat}`).join(';');
            return fetch(`${base}/${posA.lon},${posA.lat};${partial};${BLOIS.lon},${BLOIS.lat}?overview=false`).then(r => r.json());
        });

        // Matrice de durées pour optimisation d'ordre (2+ RDVs uniquement)
        const allPoints    = [posA, ...posStops, BLOIS].map(p => `${p.lon},${p.lat}`).join(';');
        const tableRequest = posStops.length >= 2
            ? fetch(`https://router.project-osrm.org/table/v1/driving/${allPoints}?annotations=duration`).then(r => r.json()).catch(() => null)
            : Promise.resolve(null);

        let dataDirect, dataDetour, dataIntermediate, dataTable;
        try {
            const results = await Promise.all([
                fetch(`${base}/${posA.lon},${posA.lat};${BLOIS.lon},${BLOIS.lat}?overview=false`).then(r => r.json()),
                fetch(`${base}/${posA.lon},${posA.lat};${stopsCoords};${BLOIS.lon},${BLOIS.lat}?overview=false`).then(r => r.json()),
                ...intermediateRequests,
                tableRequest,
            ]);
            dataDirect       = results[0];
            dataDetour       = results[1];
            dataIntermediate = results.slice(2, 2 + intermediateRequests.length);
            dataTable        = results[results.length - 1];
        } catch {
            throw new Error("Service de calcul indisponible");
        }

        if (!dataDirect.routes?.[0] || !dataDetour.routes?.[0]) throw new Error("Itinéraire introuvable");

        const minDirect    = Math.round(dataDirect.routes[0].duration / 60);
        const minDetour    = Math.round(dataDetour.routes[0].duration / 60);
        const distDirectKm = (dataDirect.routes[0].distance / 1000).toFixed(1);
        const distDetourKm = (dataDetour.routes[0].distance / 1000).toFixed(1);

        // Arrondir le delta brut pour éviter les -1 min par arrondi séparé
        const extraRaw = dataDetour.routes[0].duration - dataDirect.routes[0].duration;
        const extra    = Math.max(0, Math.round(extraRaw / 60));

        // Détail incrémental par RDV : coût de chaque stop par rapport à l'étape précédente
        // allSteps = [direct, via S1, via S1+S2, ..., via tous]
        const allSteps = [dataDirect, ...dataIntermediate, dataDetour];
        const stepDeltas = posStops.map((_, i) => {
            const raw = allSteps[i + 1].routes?.[0]?.duration - allSteps[i].routes?.[0]?.duration;
            return isFinite(raw) ? Math.max(0, Math.round(raw / 60)) : null;
        });

        const status = extra < 10
            ? { cls: 'status-ok',   icon: STATUS_SVG.ok,   label: 'Sur le trajet', title: 'Détour < 10 min' }
            : extra < 25
            ? { cls: 'status-warn', icon: STATUS_SVG.warn, label: 'Petit détour',   title: 'Détour entre 10 et 25 min' }
            : { cls: 'status-bad',  icon: STATUS_SVG.bad,  label: 'Trop de détour', title: 'Détour > 25 min' };

        const extraSign  = extra === 0 ? 'Aucun' : `+${extra}`;
        const rdvLabel   = retourStopIds.length > 1 ? `Avec ces ${retourStopIds.length} RDVs` : 'Avec ce RDV';
        const waypoints  = stopVals.map(encodeURIComponent).join('|');
        const mapsRetourUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(startVal)}&waypoints=${waypoints}&destination=${encodeURIComponent('Blois, 41000')}&travelmode=driving`;

        const breakdownHtml = retourStopIds.length > 1
            ? `<div class="stop-breakdown">${stopVals.map((v, i) => {
                const name  = v.split(',')[0].trim();
                const delta = stepDeltas[i];
                const txt   = delta === null ? '–' : delta === 0 ? 'Aucun' : `+${delta} min`;
                return `<div class="stop-breakdown-row">
                    <span class="stop-breakdown-name">${name}</span>
                    <span class="stop-breakdown-delta">${txt}</span>
                </div>`;
              }).join('')}</div>`
            : '';

        let optimalHtml = '';
        if (posStops.length >= 2 && dataTable?.durations) {
            const n        = posStops.length;
            const d        = dataTable.durations; // d[i][j] secondes ; 0=A, 1..n=stops, n+1=Blois
            const identity = posStops.map((_, i) => i);

            function routeDur(perm) {
                let t = d[0][perm[0] + 1];
                for (let i = 0; i < perm.length - 1; i++) t += d[perm[i] + 1][perm[i + 1] + 1];
                return t + d[perm[perm.length - 1] + 1][n + 1];
            }

            const currentDur = routeDur(identity);
            let bestPerm = identity, bestDur = currentDur;
            for (const perm of getPermutations(identity)) {
                const dur = routeDur(perm);
                if (dur < bestDur) { bestDur = dur; bestPerm = perm; }
            }

            const savedMin = Math.round((currentDur - bestDur) / 60);
            if (savedMin >= 1 && bestPerm.some((v, i) => v !== identity[i])) {
                const names = bestPerm.map(i => stopVals[i].split(',')[0].trim());
                optimalHtml = `<div class="optimal-order">
                    <div class="optimal-order-header">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                        Ordre optimal — économise ${savedMin} min
                    </div>
                    <div class="optimal-order-stops">${names.join(' → ')}</div>
                </div>`;
            }
        }

        const r = document.getElementById('resultRetour');
        r.className = 'result-box';
        r.style.display = 'block';
        r.innerHTML = `
            <div class="result-success">
                <div class="compare-rows">
                    <div class="compare-row">
                        <span class="compare-label">Direct → Blois</span>
                        <div class="compare-val-col">
                            <span class="compare-val">${formatDuration(minDirect)}</span>
                            <span class="compare-sub">${distDirectKm} km</span>
                        </div>
                    </div>
                    <div class="compare-row">
                        <span class="compare-label">${rdvLabel}</span>
                        <div class="compare-val-col">
                            <span class="compare-val">${formatDuration(minDetour)}</span>
                            <span class="compare-sub">${distDetourKm} km</span>
                        </div>
                    </div>
                </div>
                <div class="detour-hero-wrap">
                    <div class="detour-hero-label">Détour estimé</div>
                    <div class="detour-hero">
                        <span class="val">${extraSign}</span>
                        ${extra > 0 ? '<span class="unit">min</span>' : ''}
                    </div>
                </div>
                <span class="status-badge ${status.cls}" title="${status.title}">${status.icon} ${status.label}</span>
                ${breakdownHtml}
                ${optimalHtml}
                <button class="btn-maps" id="mapsRetourBtn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                    Voir dans Google Maps
                </button>
            </div>`;
        void r.offsetWidth;
        r.classList.add('visible');
        document.getElementById('mapsRetourBtn').addEventListener('click', () => window.open(mapsRetourUrl, '_blank'));
        restoreBtn('calcRetourBtn');
        saveRetourState();
    } catch (err) {
        showError('resultRetour', 'calcRetourBtn', err.message);
    }
}
