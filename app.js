/**
 * InventApp PWA - Lógica Principal Estandarizada
 */

const AppState = {
    loggedIn: false,
    currentRole: null,
    currentUserName: null,
    currentUserEmail: null,
    catalog: [],
    todayTasks: [],
    counts: [],
    history: []
};

const SUPABASE_URL = 'https://wfhyzlubzzkvnyztqjrt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0pwlDVxz0DAEKHgGAsCB2Q_Ru6TNHKl';
let supabaseClient = null;
const USE_SUPABASE = SUPABASE_URL !== '<YOUR_SUPABASE_URL>' && SUPABASE_ANON_KEY !== '<YOUR_SUPABASE_ANON_KEY>';

// Catálogo base de prueba por si no cargan Excel
const initialCatalog = [
    { id: 'alp-01', provider: 'alpina', name: 'Leche Entera 1L', code: 'ALP-101' },
    { id: 'zen-01', provider: 'zenu', name: 'Salchicha Manguera', code: 'ZEN-201' },
    { id: 'fle-01', provider: 'fleischmann', name: 'Levadura Seca 500g', code: 'FLE-301' },
    { id: 'uni-01', provider: 'unilever', name: 'Shampoo Dove 400ml', code: 'UNI-401' },
    { id: 'fam-01', provider: 'familia', name: 'Papel Higiénico AcolchaMax', code: 'FAM-501' }
];

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initApp();
});

async function initApp() {
    initTheme();
    registerServiceWorker();
    setupInstallPrompt();
    await loadData();
    await initializeUserSession();
}

function initTheme() {
    try {
        const saved = localStorage.getItem('ia_theme') || 'dark';
        document.body.classList.remove('light-theme', 'dark-theme');
        document.body.classList.add(`${saved}-theme`);
        const icon = document.getElementById('theme-icon');
        if (icon) icon.setAttribute('data-lucide', saved === 'dark' ? 'moon' : 'sun');
        lucide.createIcons();
    } catch (e) {
        console.warn('initTheme error', e);
    }
}

function toggleTheme() {
    try {
        const currentlyDark = document.body.classList.contains('dark-theme');
        const next = currentlyDark ? 'light' : 'dark';
        document.body.classList.remove('light-theme', 'dark-theme');
        document.body.classList.add(`${next}-theme`);
        localStorage.setItem('ia_theme', next);
        const icon = document.getElementById('theme-icon');
        if (icon) icon.setAttribute('data-lucide', next === 'dark' ? 'moon' : 'sun');
        lucide.createIcons();
        showToast(`Tema cambiado a ${next === 'dark' ? 'Oscuro' : 'Claro'}`, 'success');
    } catch (e) {
        console.warn('toggleTheme error', e);
    }
}

function showLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    const appContainer = document.querySelector('.app-container');
    if (loginScreen) loginScreen.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
}

async function initializeUserSession() {
    if (!USE_SUPABASE || !supabaseClient) {
        showLoginScreen();
        return;
    }

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
        console.warn('Supabase session error', error);
        showLoginScreen();
        return;
    }

    const user = data?.session?.user;
    if (user) {
        await signInUser(user);
    } else {
        showLoginScreen();
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value.trim();

    if (!email || !password) {
        showToast('Ingresa tu correo y contraseña.', 'danger');
        return;
    }

    if (!USE_SUPABASE || !supabaseClient) {
        if (fallbackLocalLogin(email, password)) return;
        showToast('No hay conexión a Supabase. Revisa tu configuración.', 'danger');
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.warn('Supabase login error', error);
            if (fallbackLocalLogin(email, password)) return;
            showToast('Correo o contraseña incorrectos. Intenta de nuevo.', 'danger');
            return;
        }

        const user = data?.user;
        if (!user) {
            showToast('No se pudo autenticar al usuario.', 'danger');
            return;
        }

        await signInUser(user);
    } catch (err) {
        console.error('Error en el login de Supabase:', err);
        if (fallbackLocalLogin(email, password)) return;
        showToast('Error de conexión. Intenta nuevamente.', 'danger');
    }
}

function fallbackLocalLogin(email, password) {
    const localUsers = {
        'anyi.mosquera@dechss.com': { password: 'Admin123!', role: 'admin', name: 'Anyi Mosquera' },
        'quebin.lotero@dechss.com': { password: 'Worker123!', role: 'worker', name: 'Quebin Lotero' }
    };

    const user = localUsers[email?.toLowerCase()];
    if (!user || user.password !== password) {
        return false;
    }
    AppState.loggedIn = true;
    AppState.currentRole = user.role;
    AppState.currentUserName = user.name || (user.role === 'admin' ? 'Administrador' : 'Trabajador');
    AppState.currentUserEmail = email;
    updateRoleSwitcherVisibility(user.role);

    document.getElementById('login-screen').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    switchRole(user.role);
    updateUserDisplay();
    showToast(`Bienvenido ${user.name}`, 'success');
    return true;
}

async function signInUser(user) {
    const role = await getSupabaseUserRole(user);
    AppState.loggedIn = true;
    AppState.currentRole = role;
    updateRoleSwitcherVisibility(role);

    document.getElementById('login-screen').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    switchRole(role);
    AppState.currentUserName = user?.user_metadata?.full_name || user?.email || (role === 'admin' ? 'Administrador' : 'Trabajador');
    AppState.currentUserEmail = user?.email || '';
    updateUserDisplay();
    showToast(`Bienvenido ${AppState.currentUserName}`, 'success');
}

function updateUserDisplay() {
    try {
        const nameEl = document.getElementById('user-name');
        const emailEl = document.getElementById('user-email');
        const workerWelcome = document.getElementById('worker-welcome-name');
        if (nameEl) nameEl.textContent = AppState.currentUserName || 'Usuario';
        if (emailEl) emailEl.textContent = AppState.currentUserEmail || '';
        if (workerWelcome) {
            if (AppState.currentRole === 'worker') {
                workerWelcome.textContent = `¡Hola, ${AppState.currentUserName || 'Auxiliar'}!`;
            } else {
                workerWelcome.textContent = '';
            }
        }
    } catch (e) {
        console.warn('updateUserDisplay error', e);
    }
}

async function getSupabaseUserRole(user) {
    const metadataRole = user?.user_metadata?.role;
    if (metadataRole) {
        return metadataRole;
    }

    if (!supabaseClient) {
        return 'worker';
    }

    const { data, error } = await supabaseClient.from('profiles').select('role').eq('id', user.id).single();
    if (!error && data?.role) {
        return data.role;
    }

    return 'worker';
}

function updateRoleSwitcherVisibility(role) {
    const adminBtn = document.getElementById('btn-role-admin');
    const workerBtn = document.getElementById('btn-role-worker');
    if (role === 'worker') {
        if (adminBtn) adminBtn.style.display = 'none';
        if (workerBtn) workerBtn.style.display = 'flex';
    } else {
        if (adminBtn) adminBtn.style.display = 'flex';
        if (workerBtn) workerBtn.style.display = 'none';
    }
}

let deferredInstallPrompt = null;

function initSupabase() {
    if (!USE_SUPABASE) return;
    if (supabaseClient) return;
    if (typeof window.supabase === 'undefined') {
        showToast('No se cargó la librería Supabase. Asegúrate de tener conexión a internet.', 'danger');
        return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

async function fetchSupabaseProducts() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.from('products').select('*');
    if (error) {
        console.warn('Supabase products error', error);
        if (error.code === 'PGRST205') {
            showToast('Tabla "products" no encontrada en Supabase. Revisa la configuración (ver consola).', 'danger');
            console.warn('Supabase: missing table products. Run this SQL in Supabase SQL editor to create it:');
            console.warn(`\n-- Crear tabla products (adaptar tipos)\nCREATE TABLE public.products (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  provider text,\n  name text NOT NULL,\n  code text,\n  embalaje integer DEFAULT 1,\n  expected_stock integer DEFAULT 0,\n  precio numeric DEFAULT 0,\n  created_at timestamp with time zone DEFAULT now()\n);\n`);
        } else {
            showToast('No se pudieron cargar los productos desde Supabase. Revisa la consola para más detalles.', 'danger');
        }
        return;
    }
    if (data && data.length) {
        AppState.catalog = data.map(item => ({
            id: item.id || item.code || `supab-${Date.now()}`,
            provider: item.provider || 'general',
            name: item.name || 'Sin nombre',
            code: item.code || '',
            embalaje: item.embalaje || 1,
            expectedStock: item.expected_stock || item.expectedStock || 0,
            precio: item.precio || 0
        }));
        saveData();
    }
}

async function loadData() {
    const savedCatalog = localStorage.getItem('ia_catalog');
    const savedTasks = localStorage.getItem('ia_todayTasks');
    const savedCounts = localStorage.getItem('ia_counts');
    const savedHistory = localStorage.getItem('ia_history');

    AppState.catalog = savedCatalog ? JSON.parse(savedCatalog) : initialCatalog;
    AppState.todayTasks = savedTasks ? JSON.parse(savedTasks) : [];
    AppState.counts = savedCounts ? JSON.parse(savedCounts) : [];
    AppState.history = savedHistory ? JSON.parse(savedHistory) : [];

    if (USE_SUPABASE) {
        initSupabase();
        await fetchSupabaseProducts();
    }
}

function saveData() {
    localStorage.setItem('ia_catalog', JSON.stringify(AppState.catalog));
    localStorage.setItem('ia_todayTasks', JSON.stringify(AppState.todayTasks));
    localStorage.setItem('ia_counts', JSON.stringify(AppState.counts));
    localStorage.setItem('ia_history', JSON.stringify(AppState.history));
    
    if (AppState.currentRole === 'admin') updateAdminDashboard();
}

async function pushHistoryToSupabase(records) {
    if (!supabaseClient) return;
    const payload = records.map(record => ({
        date: record.date,
        product_name: record.name,
        product_code: record.code,
        provider: record.provider,
        embalaje: record.embalaje,
        expected_stock: record.expectedStock,
        cajas: record.cajas,
        unidades: record.unidades,
        total_contado: record.totalContado,
        diff_uds: record.diffUds,
        diff_valor_raw: record.diffValorRaw,
        descuadre_formateado: record.descuadreFormateado,
        averias: record.averias
    }));
    const { error } = await supabaseClient.from('inventory_history').insert(payload);
    if (error) {
        console.warn('Supabase history insert error', error);
        showToast('No se pudo sincronizar el historial con Supabase.', 'warning');
    }
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('Service Worker registrado:', reg.scope);
                if (reg.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
            })
            .catch(err => {
                console.warn('No se pudo registrar el Service Worker:', err);
            });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    }
}


function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        const installButton = document.getElementById('btn-install-app');
        if (installButton) {
            installButton.style.display = 'inline-flex';
        }
    });
}

function promptInstall() {
    if (!deferredInstallPrompt) {
        showToast('La instalación no está disponible en este momento.', 'info');
        return;
    }

    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(choiceResult => {
        if (choiceResult.outcome === 'accepted') {
            showToast('Instalación aceptada. ¡Disfruta la app!', 'success');
        } else {
            showToast('Instalación cancelada.', 'info');
        }
        const installButton = document.getElementById('btn-install-app');
        if (installButton) installButton.style.display = 'none';
        deferredInstallPrompt = null;
    });
}

function switchRole(role) {
    AppState.currentRole = role;
    document.querySelectorAll('.role-pill-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-role-${role}`).classList.add('active');

    document.querySelectorAll('.role-view').forEach(view => {
        view.classList.remove('active');
        view.style.display = 'none';
    });
    
    const activeView = document.getElementById(`view-${role}`);
    activeView.style.display = 'flex';
    setTimeout(() => activeView.classList.add('active'), 50);

    if (role === 'admin') {
        switchAdminTab('assign');
        renderAdminCatalog('all');
        updateAdminDashboard();
        renderAdminHistory();
    } else {
        renderWorkerTasks();
    }
}

function switchAdminTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    const targetBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
    if (targetBtn) targetBtn.classList.add('active');

    document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });

    const activeContent = document.getElementById(`admin-tab-${tabId}`);
    activeContent.style.display = 'block';
    setTimeout(() => activeContent.classList.add('active'), 50);
}

// --- Lógica ADMIN ---

// EXCEL UPLOAD LOGIC
function handleExcelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        
        const selectedProvider = document.getElementById('excel-provider-select').value;
        let newItems = [];
        rawJson.forEach((row, index) => {
            const keys = Object.keys(row);
            let codigo = '';
            let nombre = '';
            let embalaje = 1;
            let cantidad = 0;
            let precio = 0;

            keys.forEach(k => {
                const kl = k.toLowerCase();
                if (kl.includes('cod') || kl.includes('cód')) codigo = row[k];
                if (kl.includes('nom') || kl.includes('desc') || kl.includes('prod')) nombre = row[k];
                if (kl.includes('emb')) embalaje = row[k];
                if (kl.includes('inv') || kl.includes('cant') || kl.includes('stock')) cantidad = row[k];
                if (kl.includes('vlr') || kl.includes('val') || kl.includes('prec') || kl.includes('iva')) precio = row[k];
            });

            if (codigo && nombre) {
                newItems.push({
                    id: 'ext-' + Date.now() + '-' + index,
                    code: String(codigo),
                    name: String(nombre),
                    embalaje: parseInt(embalaje) || 1,
                    expectedStock: parseInt(cantidad) || 0,
                    precio: parseFloat(String(precio).replace(',', '.')) || 0,
                    provider: selectedProvider
                });
            }
        });

        if (newItems.length > 0) {
            // Al subir un excel, reemplazamos las tareas de hoy por lo subido
            AppState.catalog = [...AppState.catalog, ...newItems].filter((v,i,a)=>a.findIndex(v2=>(v2.code===v.code))===i); // merge unique
            AppState.todayTasks = newItems; // Se asigna automáticamente para hoy
            AppState.counts = []; // Reiniciamos los conteos si hay carga masiva nueva
            saveData();
            renderAdminCatalog('all');
            showToast(`¡Excel cargado! Se han asignado ${newItems.length} productos para contar hoy.`, 'success');
        } else {
            showToast('No se encontraron columnas de "Código" y "Nombre" en el archivo.', 'danger');
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = ''; // Reset input
}

function renderAdminCatalog(providerFilter) {
    const tbody = document.getElementById('catalog-table-body');
    tbody.innerHTML = '';
    const searchTerm = document.getElementById('catalog-search').value.toLowerCase();

    AppState.catalog.forEach(item => {
        if (providerFilter !== 'all' && item.provider !== providerFilter) return;
        if (searchTerm && !item.name.toLowerCase().includes(searchTerm) && !item.code.toLowerCase().includes(searchTerm)) return;

        const isAssigned = AppState.todayTasks.some(t => t.id === item.id);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="custom-checkbox ${isAssigned ? 'checked' : ''}" onclick="toggleTaskAssignment('${item.id}', this)">
                    <i data-lucide="check"></i>
                </div>
            </td>
            <td>
                <strong>${item.name}</strong><br>
                <span class="product-code-tag">${item.code}</span>
            </td>
            <td><span class="provider-badge ${item.provider}">${item.provider}</span></td>
        `;
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

function filterCatalogByProvider(provider) {
    document.querySelectorAll('.provider-filter-pill').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    renderAdminCatalog(provider);
}

function handleCatalogSearch() {
    renderAdminCatalog('all');
}

function toggleTaskAssignment(itemId, element) {
    const idx = AppState.todayTasks.findIndex(t => t.id === itemId);
    if (idx >= 0) {
        AppState.todayTasks.splice(idx, 1);
        element.classList.remove('checked');
    } else {
        const item = AppState.catalog.find(c => c.id === itemId);
        AppState.todayTasks.push({...item}); 
        element.classList.add('checked');
    }
    updateAdminDashboard();
}

function publishDailyTask() {
    if (AppState.todayTasks.length === 0) {
        showToast('Debes seleccionar productos para publicar.', 'danger');
        return;
    }
    AppState.counts = []; 
    saveData();
    showToast(`Tarea publicada: ${AppState.todayTasks.length} productos asignados al trabajador.`, 'success');
}

function updateAdminDashboard() {
    document.getElementById('admin-metric-assigned').textContent = AppState.todayTasks.length;
    const countedTasks = AppState.counts.length;
    const progressPerc = AppState.todayTasks.length > 0 ? Math.round((countedTasks / AppState.todayTasks.length) * 100) : 0;
    
    document.getElementById('admin-metric-progress').textContent = `${progressPerc}%`;
    document.getElementById('admin-progress-bar').style.width = `${progressPerc}%`;
    document.getElementById('admin-metric-progress-subtitle').textContent = `${countedTasks} de ${AppState.todayTasks.length} contados`;

    let totalAverias = 0;
    let grandDiffUds = 0;
    let grandDiffValor = 0;
    const monitorTbody = document.getElementById('live-detail-table-body');
    monitorTbody.innerHTML = '';

    if(AppState.todayTasks.length === 0) {
        monitorTbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No se han publicado tareas para hoy.</td></tr>';
    }

    AppState.counts.forEach(countInfo => {
        totalAverias += parseInt(countInfo.averias) || 0;
        
        const emb = countInfo.item.embalaje || 1;
        const prec = countInfo.item.precio || 0;
        const totalContado = (parseInt(countInfo.cajas) * emb) + parseInt(countInfo.unidades);
        const expected = countInfo.item.expectedStock || 0;
        
        const diffUds = totalContado - expected;
        const diffValor = diffUds * prec;

        grandDiffUds += diffUds;
        grandDiffValor += diffValor;

        let diffHtml = '';
        if(diffUds !== 0) {
            diffHtml = `<br><span style="color:${diffUds>0?'#059669':'#ef4444'}; font-size:0.75rem">${diffUds>0?'+':''}${diffUds} uds</span>`;
        }
        
        let valorHtml = '-';
        if(diffValor !== 0) {
            const fmtVal = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(diffValor);
            valorHtml = `<span style="color:${diffValor>0?'#059669':'#ef4444'}; font-weight:bold; font-size:0.85rem">${fmtVal}</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${countInfo.item.name}</strong><br><span style="font-size:0.75rem">${countInfo.item.code}</span></td>
            <td>${emb}</td>
            <td>${expected}</td>
            <td><strong>${totalContado}</strong> ${diffHtml}</td>
            <td>${valorHtml}</td>
            <td class="${countInfo.averias > 0 ? 'text-red' : ''}"><strong>${countInfo.averias}</strong></td>
        `;
        monitorTbody.appendChild(tr);
    });

    document.getElementById('admin-metric-alerts').textContent = totalAverias;

    // Update monitor totals bar
    const fmtGrandValor = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(grandDiffValor);
    const diffUdsEl = document.getElementById('monitor-total-diff-uds');
    const diffValorEl = document.getElementById('monitor-total-diff-valor');
    const averiasEl = document.getElementById('monitor-total-averias');
    
    if (diffUdsEl) {
        diffUdsEl.textContent = (grandDiffUds > 0 ? '+' : '') + grandDiffUds;
        diffUdsEl.style.color = grandDiffUds === 0 ? '' : (grandDiffUds > 0 ? '#059669' : '#ef4444');
    }
    if (diffValorEl) {
        diffValorEl.textContent = fmtGrandValor;
        diffValorEl.style.color = grandDiffValor === 0 ? '' : (grandDiffValor > 0 ? '#059669' : '#ef4444');
    }
    if (averiasEl) {
        averiasEl.textContent = totalAverias;
    }
}

function renderAdminHistory() {
    applyHistoryFilters();
}

function applyHistoryFilters() {
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '';

    const dateFrom = document.getElementById('filter-date-from')?.value || '';
    const dateTo = document.getElementById('filter-date-to')?.value || '';
    const productSearch = (document.getElementById('filter-product')?.value || '').toLowerCase();
    const providerFilter = document.getElementById('filter-provider')?.value || 'all';

    function parseHistoryDate(dateStr) {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const d = parts[0].padStart(2, '0');
            const m = parts[1].padStart(2, '0');
            const y = parts[2];
            return `${y}-${m}-${d}`;
        }
        return dateStr;
    }

    let filtered = AppState.history.filter(rec => {
        const recProvider = (rec.provider || '').toLowerCase();
        const recName = (rec.name || '').toLowerCase();
        const recCode = (rec.code || '').toLowerCase();

        if (providerFilter !== 'all' && recProvider !== providerFilter) return false;
        if (productSearch && !recName.includes(productSearch) && !recCode.includes(productSearch)) return false;

        if (dateFrom || dateTo) {
            const recDate = parseHistoryDate(rec.date);
            if (recDate) {
                if (dateFrom && recDate < dateFrom) return false;
                if (dateTo && recDate > dateTo) return false;
            }
        }
        return true;
    });

    let totalDiffUds = 0;
    let totalDiffValor = 0;
    let totalAverias = 0;
    filtered.forEach(rec => {
        totalDiffUds += rec.diffUds || 0;
        totalDiffValor += rec.diffValorRaw || 0;
        totalAverias += parseInt(rec.averias) || 0;
    });

    const fmtTotalValor = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(totalDiffValor);
    const summaryBar = document.getElementById('history-summary');
    if (summaryBar) {
        if (filtered.length > 0) {
            summaryBar.style.display = 'grid';
            const el1 = document.getElementById('hist-total-diff-uds');
            const el2 = document.getElementById('hist-total-diff-valor');
            const el3 = document.getElementById('hist-total-averias');
            if (el1) {
                el1.textContent = (totalDiffUds > 0 ? '+' : '') + totalDiffUds;
                el1.style.color = totalDiffUds === 0 ? '' : (totalDiffUds > 0 ? '#059669' : '#ef4444');
            }
            if (el2) {
                el2.textContent = fmtTotalValor;
                el2.style.color = totalDiffValor === 0 ? '' : (totalDiffValor > 0 ? '#059669' : '#ef4444');
            }
            if (el3) el3.textContent = totalAverias;
        } else {
            summaryBar.style.display = 'none';
        }
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4">No hay registros que coincidan con los filtros.</td></tr>';
        return;
    }

    filtered.slice().reverse().forEach(record => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${record.date}</td>
            <td><strong>${record.name}</strong></td>
            <td><span class="provider-badge ${record.provider || ''}">${record.provider || '-'}</span></td>
            <td>${record.embalaje || 1}</td>
            <td>${record.expectedStock || 0}</td>
            <td>${record.totalContado}</td>
            <td style="color:${record.diffUds > 0 ? '#059669' : record.diffUds < 0 ? '#ef4444' : ''}; font-weight:600">${record.diffUds !== 0 ? (record.diffUds > 0 ? '+' : '') + record.diffUds : '-'}</td>
            <td style="color:${record.diffValorRaw > 0 ? '#059669' : record.diffValorRaw < 0 ? '#ef4444' : ''}; font-weight:600">${record.descuadreFormateado || '-'}</td>
            <td class="${record.averias > 0 ? 'text-red' : ''}">${record.averias}</td>
        `;
        tbody.appendChild(tr);
    });
}

function clearAllHistory() {
    if(confirm('¿ELIMINAR TODO EL HISTORIAL?')) {
        AppState.history = [];
        saveData();
        renderAdminHistory();
        showToast('Historial borrado', 'success');
    }
}

// Finalizar día: guardar en historial y generar PDF
window.finishDay = async function() {
    if (AppState.todayTasks.length === 0) {
        showToast('No hay productos asignados para finalizar.', 'danger');
        return;
    }

    const dateStr = new Date().toLocaleDateString('es-CO');
    const dateFile = new Date().toISOString().slice(0, 10);

    // Build records for history and PDF, including 0 conteos cuando no se contó
    const dayRecords = AppState.todayTasks.map(item => {
        const countEntry = AppState.counts.find(c => c.item.id === item.id);
        const cajas = countEntry ? parseInt(countEntry.cajas) || 0 : 0;
        const unidades = countEntry ? parseInt(countEntry.unidades) || 0 : 0;
        const averias = countEntry ? parseInt(countEntry.averias) || 0 : 0;
        const emb = item.embalaje || 1;
        const totalContado = (cajas * emb) + unidades;
        const diff = totalContado - (item.expectedStock || 0);
        const diffValor = diff * (item.precio || 0);
        const fmtVal = diffValor !== 0 ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(diffValor) : '-';

        const record = {
            date: dateStr,
            name: item.name,
            code: item.code,
            provider: item.provider,
            embalaje: emb,
            precio: item.precio || 0,
            expectedStock: item.expectedStock || 0,
            cajas,
            unidades,
            totalContado,
            diffUds: diff,
            diffValorRaw: diffValor,
            descuadreFormateado: fmtVal,
            averias
        };
        AppState.history.push(record);
        return record;
    });

    // Generate PDF
    generatePDF(dayRecords, dateStr, dateFile);

    if (USE_SUPABASE) {
        await pushHistoryToSupabase(dayRecords);
    }

    AppState.counts = [];
    AppState.todayTasks = [];
    saveData();
    renderAdminHistory();
    updateAdminDashboard();
    showToast('Día finalizado. PDF generado y descargado.', 'success');
}

function getJsPDFCtor() {
    return window.jsPDF || window.jspdf?.jsPDF || window.jspdf || null;
}

function generatePDF(records, dateStr, dateFile) {
    const jsPDFCtor = getJsPDFCtor();
    if (!jsPDFCtor) {
        showToast('No se pudo cargar la librería jsPDF. Abre la app desde un servidor HTTP o revisa los archivos locales.', 'danger');
        return;
    }

    const doc = new jsPDFCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const providerName = records.length > 0 ? (records[0].provider || 'Proveedor no definido').toUpperCase() : 'SIN PROVEEDOR';

    // Título: INVENTARIO {PROVEEDOR} {DIA} {MES_MAYUS}
    // Use the local formatted date (`dateStr`) to avoid UTC offset issues.
    const displayDate = (() => {
        try {
            // dateStr expected like '20/5/2026' (es-CO). Parse and get month name locally.
            const parts = String(dateStr).split('/');
            const day = parts[0].padStart(2, '0');
            const monthIdx = (parseInt(parts[1], 10) || 1) - 1;
            const year = parts[2] || new Date().getFullYear();
            const localDate = new Date(year, monthIdx, day);
            return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(localDate).toUpperCase();
        } catch (e) {
            return dateStr.toUpperCase();
        }
    })();
    const titleText = `INVENTARIO ${providerName} ${displayDate}`;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.text(titleText, pageWidth / 2, 18, { align: 'center' });

    // Fecha en la esquina superior derecha (más discreta)
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text(`Fecha: ${dateStr}`, pageWidth - 18, 24, { align: 'right' });

    const tableData = records.map(r => {
        const diffLabel = r.diffUds > 0 ? `+${r.diffUds}` : `${r.diffUds}`;
        return [
            r.name,
            r.code || '',
            r.embalaje,
            r.expectedStock,
            r.cajas,
            r.unidades,
            r.totalContado,
            diffLabel,
            r.descuadreFormateado,
            r.averias
        ];
    });

    // Calcular suma total de la columna "Dif. Valor" (raw) y añadir fila final
    const totalDiffValorRaw = records.reduce((s, r) => s + (parseFloat(r.diffValorRaw) || 0), 0);
    const fmtTotalDiffValor = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(totalDiffValorRaw);
    // Añadimos la fila de totales como última fila para que aparezca en la columna correspondiente
    tableData.push(['Totales', '', '', '', '', '', '', '', fmtTotalDiffValor, '']);

    doc.autoTable({
        startY: 46,
        head: [[
            'Producto', 'Código', 'Emb.', 'Inv. Excel', 'Cajas', 'Uds', 'Total', 'Dif. Uds', 'Dif. Valor', 'Averías'
        ]],
        body: tableData,
        styles: {
            fontSize: 9,
            cellPadding: 4,
            textColor: [30, 41, 59],
            minCellHeight: 8
        },
        headStyles: {
            fillColor: [249, 115, 22],
            textColor: 255,
            fontStyle: 'bold'
        },
        alternateRowStyles: {
            fillColor: [255, 247, 237]
        },
        columnStyles: {
            0: { cellWidth: 65 },
            1: { cellWidth: 25 },
            2: { cellWidth: 15 },
            3: { cellWidth: 22 },
            4: { cellWidth: 18 },
            5: { cellWidth: 18 },
            6: { cellWidth: 18 },
            7: { cellWidth: 20, halign: 'center' },
            8: { cellWidth: 30, halign: 'right' },
            9: { cellWidth: 18, halign: 'center' }
        },
        margin: { left: 14, right: 14 },
        didParseCell: function(data) {
            // Si es la fila de totales, resaltarla y evitar coloraciones por valor
            if (data.section === 'body' && data.row && Array.isArray(data.row.raw) && data.row.raw[0] === 'Totales') {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.textColor = [30, 41, 59];
                if (data.column.index === 8) data.cell.styles.halign = 'right';
                return;
            }
            if (data.section === 'body') {
                if (data.column.index === 7) {
                    const value = parseFloat(String(data.cell.raw).replace(/[^0-9\-+]/g, '')) || 0;
                    data.cell.styles.textColor = value < 0 ? [220, 38, 38] : [16, 185, 129];
                }
                if (data.column.index === 8) {
                    const value = parseFloat(String(data.cell.raw).replace(/[^0-9\-+\$\.,]/g, '')) || 0;
                    data.cell.styles.textColor = value < 0 ? [220, 38, 38] : [30, 64, 175];
                    data.cell.styles.halign = 'right';
                }
            }
        }
    });
    // Colocar la firma debajo de la tabla (sin el recuadro de totales)
    const signatureY = doc.lastAutoTable.finalY + 12;
    const signatureX = 14;
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(0.5);
    doc.line(signatureX, signatureY + 12, 120, signatureY + 12);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Firma:', signatureX, signatureY + 8);

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(107, 114, 128);
        doc.text('InventApp PWA © 2026', 14, pageHeight - 8);
        doc.text(`Página ${i} de ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
    }

    doc.save(`Inventario_DECHSS_${dateFile}.pdf`);
}

// --- Lógica TRABAJADOR ---

function renderWorkerTasks() {
    const list = document.getElementById('worker-task-list');
    const emptyState = document.getElementById('worker-empty-state');
    
    const pendingCount = AppState.todayTasks.length - AppState.counts.length;
    document.getElementById('w-stat-pending').textContent = pendingCount;
    document.getElementById('w-stat-completed').textContent = AppState.counts.length;
    
    if (AppState.todayTasks.length === 0) {
        document.getElementById('worker-assigned-summary').textContent = 'No hay tareas cargadas.';
        list.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    document.getElementById('worker-assigned-summary').textContent = pendingCount === 0 
        ? '¡Has terminado todo por hoy!' 
        : `Tienes ${pendingCount} productos pendientes por revisar.`;

    list.classList.remove('hidden');
    emptyState.classList.add('hidden');
    list.innerHTML = '';

    const groups = {};
    AppState.todayTasks.forEach(task => {
        if(!groups[task.provider]) groups[task.provider] = [];
        groups[task.provider].push(task);
    });

    for(const [provider, tasks] of Object.entries(groups)) {
        let countedInGroup = 0;
        tasks.forEach(t => { if(AppState.counts.find(c => c.item.id === t.id)) countedInGroup++; });
        const allDone = countedInGroup === tasks.length;

        const groupDiv = document.createElement('div');
        groupDiv.className = `provider-group-card ${provider} ${allDone ? 'all-done' : ''}`;
        
        const header = document.createElement('div');
        header.className = 'provider-group-header';
        header.onclick = () => groupDiv.classList.toggle('open');
        
        let icon = 'package';
        if(provider==='alpina') icon='thermometer-snowflake';
        if(provider==='zenu') icon='scale';
        
        header.innerHTML = `
            <div class="group-header-info">
                <div class="group-icon-wrap bg-${provider}"><i data-lucide="${icon}"></i></div>
                <div>
                    <h3 class="group-title">${provider}</h3>
                    <span class="group-progress">${countedInGroup} de ${tasks.length} contados</span>
                </div>
            </div>
            <div class="group-toggle-icon">
                <i data-lucide="chevron-down"></i>
            </div>
        `;
        
        const content = document.createElement('div');
        content.className = 'provider-group-content';
        
        const tasksGrid = document.createElement('div');
        tasksGrid.className = 'worker-task-grid';

        tasks.forEach(task => {
            const countInfo = AppState.counts.find(c => c.item.id === task.id);
            const isCounted = !!countInfo;
            
            const card = document.createElement('div');
            card.className = `worker-item-card ${isCounted ? 'counted' : ''}`;
            card.onclick = () => openCountModal(task);
            
            let statusHtml = isCounted 
                ? `<div style="text-align:right"><span class="counted-val">${countInfo.unidades} Uds</span><br><span style="font-size:0.7rem">${countInfo.cajas} Cj | ${countInfo.averias} Av</span></div> <div class="action-circle"><i data-lucide="check"></i></div>` 
                : `<div class="action-circle"><i data-lucide="edit-2"></i></div>`;

            card.innerHTML = `
                <div class="item-info-left">
                    <span class="item-title">${task.name}</span>
                    <span class="item-code">Código: ${task.code}</span>
                </div>
                <div class="item-status-right">
                    ${statusHtml}
                </div>
            `;
            tasksGrid.appendChild(card);
        });

        content.appendChild(tasksGrid);
        groupDiv.appendChild(header);
        groupDiv.appendChild(content);
        list.appendChild(groupDiv);
    }
    lucide.createIcons();
}

let currentCountingItem = null;

function openCountModal(task) {
    currentCountingItem = task;
    const modal = document.getElementById('count-modal');
    
    document.getElementById('modal-provider-tag').className = `provider-tag ${task.provider}`;
    document.getElementById('modal-provider-tag').textContent = task.provider;
    document.getElementById('modal-product-name').textContent = task.name;
    document.getElementById('modal-product-code').textContent = `Código: ${task.code} | Emb: ${task.embalaje || 1}`;
    document.getElementById('label-cajas').textContent = `📦 Total Cajas (x${task.embalaje || 1}):`;
    
    // Conteo ciego: ya NO hay expectedHelper visible en el HTML
    const countInfo = AppState.counts.find(c => c.item.id === task.id);
    
    document.getElementById('count-unidades').value = countInfo ? countInfo.unidades : 0;
    document.getElementById('count-cajas').value = countInfo ? countInfo.cajas : 0;
    document.getElementById('count-averias').value = countInfo ? countInfo.averias : 0;

    modal.classList.add('active');
}

function closeCountModal() {
    document.getElementById('count-modal').classList.remove('active');
    currentCountingItem = null;
}

function submitProductCount() {
    const unidades = parseInt(document.getElementById('count-unidades').value) || 0;
    const cajas = parseInt(document.getElementById('count-cajas').value) || 0;
    const averias = parseInt(document.getElementById('count-averias').value) || 0;
    
    const task = currentCountingItem;
    const idx = AppState.counts.findIndex(c => c.item.id === task.id);
    
    const newCount = { item: task, unidades, cajas, averias };
    
    if(idx >= 0) {
        AppState.counts[idx] = newCount;
    } else {
        AppState.counts.push(newCount);
    }

    saveData();
    updateAdminDashboard();
    closeCountModal();
    renderWorkerTasks();
    showToast('¡Conteo registrado!', 'success');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = type === 'success' ? 'check-circle' : (type === 'danger' ? 'x-circle' : 'info');
    toast.innerHTML = `<i data-lucide="${icon}"></i> <span class="toast-message">${message}</span> <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>`;
    
    container.appendChild(toast);
    lucide.createIcons();
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}
