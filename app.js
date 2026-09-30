/**
 * InventApp PWA - Lógica Principal con Sistema de Bloques
 */

const AppState = {
    loggedIn: false,
    currentRole: null,       // 'admin' | 'worker'
    currentUserId: null,
    currentUserName: null,
    currentUserEmail: null,
    currentBlock: null,      // número de bloque del auxiliar (1-N), null = admin/no asignado
    catalog: [],
    todayTasks: [],          // todos los productos del día
    blocks: {},              // { 1: [items...], 2: [items...], ... }  distribución por bloque
    numBlocks: 5,            // cantidad de bloques configurada por el admin
    counts: [],
    history: [],
    pendingSync: { tasks: [], history: [], counts: [] },
    isOnline: true
};

const SUPABASE_URL = 'https://yvysbuirvpfcngviwybh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2eXNidWlydnBmY25ndml3eWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzcyMDUsImV4cCI6MjEwMzE1MzIwNX0.Vpw_nLNXHKVDQu6GsKoRYpPKq4dV2QZ3gDj764RooFM';
const SUPABASE_TASKS_TABLE = 'task_assignments';
let supabaseClient = null;
let taskSubscription = null;
let supabaseAvailable = true;
const USE_SUPABASE = SUPABASE_URL !== '<YOUR_SUPABASE_URL>' && SUPABASE_ANON_KEY !== '<YOUR_SUPABASE_ANON_KEY>';
const USE_SUPABASE_AUTH = false; // No se requiere auth en Supabase, usando login local y acceso anónimo para datos.
const USE_SUPABASE_PRODUCTS = false; // Si el admin sube todo con Excel, no necesitamos tabla products.
// Si ves 401 / 42501 en task_assignments, ejecuta el SQL en supabase_task_assignments_policy.sql

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
    initNetworkStatus();
    registerServiceWorker();
    hideInstallButtonIfInstalled();
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
    showCredentialsLogin();
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
}

// ── Mostrar panel de login con email/contraseña ──
function showCredentialsLogin() {
    document.getElementById('login-step-credentials').style.display = '';
    document.getElementById('login-step-block').style.display = 'none';
    lucide.createIcons();
}

// ── Mostrar panel de login por bloque ──
async function showBlockLogin() {
    document.getElementById('login-step-credentials').style.display = 'none';
    document.getElementById('login-step-block').style.display = '';
    document.getElementById('btn-enter-block').disabled = true;
    lucide.createIcons();

    // Renderizar selector de bloques disponibles
    await renderBlockSelector();
}

async function renderBlockSelector() {
    const grid = document.getElementById('block-selector-grid');
    const noTasksMsg = document.getElementById('block-no-tasks-msg');
    grid.innerHTML = '<div class="text-muted" style="text-align:center;padding:1rem;">Cargando bloques...</div>';

    let blocksData = {};   // { 1: [...items], 2: [...items] }

    if (USE_SUPABASE && supabaseClient) {
        try {
            // Solo traer publicaciones de HOY con payload no vacío
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const { data, error } = await supabaseClient
                .from(SUPABASE_TASKS_TABLE)
                .select('id, payload, blocks, status, created_at, numBlocks')
                .eq('status', 'active')
                .gte('created_at', todayStart.toISOString())
                .order('created_at', { ascending: false })
                .limit(1);

            if (!error && data?.length > 0) {
                const row = data[0];
                // Preferir campo `blocks` (nuevo sistema); fallback a payload plano
                if (row.blocks && typeof row.blocks === 'object' && Object.keys(row.blocks).length) {
                    blocksData = row.blocks;
                } else if (Array.isArray(row.payload) && row.payload.length > 0) {
                    // Publicación del sistema antiguo: agrupar por _blockNum
                    row.payload.forEach(t => {
                        const bn = t._blockNum || 1;
                        if (!blocksData[bn]) blocksData[bn] = [];
                        blocksData[bn].push(t);
                    });
                }
            }
        } catch (e) {
            console.warn('renderBlockSelector fetch error', e);
        }
    }

    // Sin fallback a localStorage — si el admin no ha publicado nada hoy, mostrar aviso
    const blockNums = Object.keys(blocksData).map(Number).filter(bn => (blocksData[bn]||[]).length > 0).sort((a,b)=>a-b);

    if (!blockNums.length) {
        grid.innerHTML = '';
        noTasksMsg.style.display = '';
        lucide.createIcons();
        return;
    }

    noTasksMsg.style.display = 'none';
    grid.innerHTML = '';

    blockNums.forEach(blockNum => {
        const items = blocksData[blockNum] || [];
        const btn = document.createElement('button');
        btn.className = 'block-select-btn';
        btn.dataset.block = blockNum;
        btn.innerHTML = `
            <span class="block-num">B${blockNum}</span>
            <span class="block-item-count">${items.length} productos</span>
        `;
        btn.onclick = () => {
            document.querySelectorAll('.block-select-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            document.getElementById('btn-enter-block').disabled = false;
        };
        grid.appendChild(btn);
    });
    lucide.createIcons();
}

async function loginWithBlock() {
    const workerName = document.getElementById('block-worker-name').value.trim();
    const selectedBtn = document.querySelector('.block-select-btn.selected');

    if (!workerName) {
        showToast('Ingresa tu nombre antes de continuar.', 'danger');
        return;
    }
    if (!selectedBtn) {
        showToast('Selecciona un bloque para continuar.', 'danger');
        return;
    }

    const blockNum = parseInt(selectedBtn.dataset.block);

    AppState.loggedIn = true;
    AppState.currentRole = 'worker';
    AppState.currentUserId = null;
    AppState.currentUserName = workerName;
    // Email único basado en nombre+bloque para identificar conteos en Supabase
    // Sanitizamos el nombre para crear un identificador seguro
    const safeName = workerName.toLowerCase().replace(/[^a-z0-9]/g, '');
    AppState.currentUserEmail = `${safeName}.b${blockNum}@inventapp.local`;
    AppState.currentBlock = blockNum;

    updateRoleSwitcherVisibility('worker');
    document.getElementById('login-screen').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    switchRole('worker');
    updateUserDisplay();
    saveLocalSession();

    if (USE_SUPABASE && supabaseClient) {
        await fetchLatestTasks();
        await fetchWorkerCountsForCurrentUser();
        subscribeTaskAssignments();
    }

    requestNotificationPermission();
    showToast(`¡Hola ${workerName}! Entraste al Bloque ${blockNum}.`, 'success');
}

function saveLocalSession() {
    const sessionData = {
        loggedIn: AppState.loggedIn,
        currentRole: AppState.currentRole,
        currentUserId: AppState.currentUserId,
        currentUserName: AppState.currentUserName,
        currentUserEmail: AppState.currentUserEmail,
        currentBlock: AppState.currentBlock
    };
    localStorage.setItem('ia_session', JSON.stringify(sessionData));
}

function clearLocalSession() {
    localStorage.removeItem('ia_session');
}

async function restoreLocalSession() {
    const sessionString = localStorage.getItem('ia_session');
    if (!sessionString) return false;

    try {
        const sessionData = JSON.parse(sessionString);
        if (!sessionData.loggedIn || !sessionData.currentRole) return false;

        AppState.loggedIn = true;
        AppState.currentRole = sessionData.currentRole;
        AppState.currentUserId = sessionData.currentUserId || null;
        AppState.currentUserName = sessionData.currentUserName || sessionData.currentUserEmail || (sessionData.currentRole === 'admin' ? 'Administrador' : 'Trabajador');
        AppState.currentUserEmail = sessionData.currentUserEmail || '';
        AppState.currentBlock = sessionData.currentBlock || null;

        updateRoleSwitcherVisibility(AppState.currentRole);
        document.getElementById('login-screen').style.display = 'none';
        document.querySelector('.app-container').style.display = 'flex';
        switchRole(AppState.currentRole);
        updateUserDisplay();

        if (USE_SUPABASE && supabaseClient) {
            // Cargar tareas primero
            await fetchLatestTasks();
            
            // Luego, si es worker, cargar sus conteos
            if (AppState.currentRole === 'worker') {
                await fetchWorkerCountsForCurrentUser();
            }
            
            subscribeTaskAssignments();
        }

        if (AppState.currentRole === 'worker') {
            requestNotificationPermission();
        }

        return true;
    } catch (error) {
        console.warn('Error restaurando sesión local:', error);
        return false;
    }
}

function initNetworkStatus() {
    AppState.isOnline = navigator.onLine;
    updateNetworkStatusUI();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
}

function updateNetworkStatusUI() {
    const statusEl = document.getElementById('network-status');
    if (!statusEl) return;
    statusEl.textContent = AppState.isOnline ? 'Online' : 'Offline';
    statusEl.className = `network-status ${AppState.isOnline ? 'online' : 'offline'}`;
}

function handleOnline() {
    AppState.isOnline = true;
    updateNetworkStatusUI();
    showToast('Conexión restaurada. Sincronizando datos pendientes...', 'success');
    if (USE_SUPABASE && supabaseClient) {
        syncPendingData();
        if (!taskSubscription) subscribeTaskAssignments();
    }
}

function handleOffline() {
    AppState.isOnline = false;
    updateNetworkStatusUI();
    showToast('Sin conexión. La app seguirá funcionando en modo offline.', 'warning');
}

async function syncPendingData() {
    if (!USE_SUPABASE || !supabaseClient || !navigator.onLine) return;

    if (AppState.pendingSync.tasks.length > 0) {
        const remainingTasks = [];
        for (const taskRecord of AppState.pendingSync.tasks) {
            const { error } = await supabaseClient.from(SUPABASE_TASKS_TABLE).insert([taskRecord]);
            if (error) {
                console.warn('Error sincronizando tarea pendiente:', error);
                remainingTasks.push(taskRecord);
            }
        }
        AppState.pendingSync.tasks = remainingTasks;
        saveData();
        if (remainingTasks.length === 0) {
            showToast('Tareas pendientes sincronizadas correctamente.', 'success');
        }
    }
    if (AppState.pendingSync.history.length > 0) {
        const remainingHistory = [];
        for (const record of AppState.pendingSync.history) {
            const { error } = await supabaseClient.from('inventory_history').insert([{
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
            }] );
            if (error) {
                console.warn('Error sincronizando historial pendiente:', error);
                remainingHistory.push(record);
            }
        }
        AppState.pendingSync.history = remainingHistory;
        saveData();
        if (remainingHistory.length === 0) {
            showToast('Historial pendiente sincronizado correctamente.', 'success');
        }
    }

    // Sincronizar conteos pendientes en cola (offline → online)
    if (AppState.currentRole === 'worker' && AppState.pendingSync.counts.length > 0) {
        const remaining = [];
        for (const countEntry of AppState.pendingSync.counts) {
            const { error } = await supabaseClient.from('worker_counts').upsert([{
                task_id: countEntry.item.id,
                worker_email: AppState.currentUserEmail,
                worker_name: AppState.currentUserName || AppState.currentUserEmail,
                block_num: AppState.currentBlock || 0,
                cajas: countEntry.cajas,
                unidades: countEntry.unidades,
                averias: countEntry.averias,
                item: countEntry.item
            }], { onConflict: 'task_id,worker_email' });

            if (error) {
                console.warn('Error sincronizando conteo pendiente para', countEntry.item.id, ':', error);
                remaining.push(countEntry);
            } else {
                // Asegurar que el conteo también esté en AppState.counts (por si se perdió)
                const idx = AppState.counts.findIndex(c => c.item.id === countEntry.item.id);
                if (idx >= 0) {
                    AppState.counts[idx] = countEntry;
                } else {
                    AppState.counts.push(countEntry);
                }
            }
        }
        AppState.pendingSync.counts = remaining;
        saveData();
        if (remaining.length === 0) {
            showToast('Conteos pendientes sincronizados correctamente.', 'success');
        } else {
            showToast(`${remaining.length} conteo(s) no pudieron sincronizarse. Se reintentará.`, 'warning');
        }
    } else if (AppState.currentRole === 'worker' && AppState.counts.length > 0) {
        // Sin cola pendiente pero hay conteos locales — sincronizar igualmente como respaldo
        const success = await syncCountsToSupabase();
        if (success) {
            showToast('Conteos locales sincronizados correctamente con el servidor.', 'success');
        }
    }
}

function forceAppUpdate() {
    showToast('Buscando actualización de la app...', 'info');
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(reg => {
            if (!reg) {
                window.location.reload();
                return;
            }
            reg.update();
            if (reg.waiting) {
                reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            if (reg.installing) {
                reg.installing.addEventListener('statechange', event => {
                    if (event.target.state === 'installed' && navigator.serviceWorker.controller) {
                        window.location.reload();
                    }
                });
            }
        });
    } else {
        window.location.reload();
    }
}

function supportsNotifications() {
    return 'Notification' in window && 'serviceWorker' in navigator;
}

function requestNotificationPermission() {
    if (!supportsNotifications()) return;
    if (Notification.permission === 'granted') return;

    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            showToast('Notificaciones activadas. Te avisaremos cuando llegue una nueva tarea.', 'success');
        } else if (permission === 'denied') {
            showToast('Notificaciones denegadas. Igual recibirás alertas en la app.', 'warning');
        }
    }).catch(err => {
        console.warn('Error solicitando permisos de notificación:', err);
    });
}

function notifyNewTaskAssignment(count = 1) {
    const message = count === 1 ? 'Tienes 1 nueva tarea.' : `Tienes ${count} nuevas tareas.`;
    showToast(message, 'success');

    if (Notification.permission === 'granted') {
        try {
            new Notification('Nueva tarea asignada', {
                body: message,
                icon: './icon-192.png'
            });
        } catch (err) {
            console.warn('Error mostrando notificación:', err);
        }
    }

    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }
}

window.logout = async function() {
    if (USE_SUPABASE && supabaseClient) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) console.warn('Error cerrando sesión en Supabase:', error);
    }
    clearLocalSession();
    AppState.loggedIn = false;
    AppState.currentRole = null;
    AppState.currentUserId = null;
    AppState.currentUserName = '';
    AppState.currentUserEmail = '';
    AppState.currentBlock = null;
    document.querySelector('.app-container').style.display = 'none';
    showLoginScreen();
    showToast('Sesión cerrada correctamente.', 'success');
};

async function initializeUserSession() {
    if (!USE_SUPABASE || !supabaseClient || !USE_SUPABASE_AUTH) {
        if (await restoreLocalSession()) return;
        showLoginScreen();
        return;
    }

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
        console.warn('Supabase session error', error);
        if (await restoreLocalSession()) return;
        showLoginScreen();
        return;
    }

    const user = data?.session?.user;
    if (user) {
        await signInUser(user);
    } else if (await restoreLocalSession()) {
        return;
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

    if (!USE_SUPABASE || !supabaseClient || !USE_SUPABASE_AUTH) {
        if (await fallbackLocalLogin(email, password)) return;
        showToast('No hay conexión a Supabase o no usas auth. Revisa tu configuración.', 'danger');
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.warn('Supabase login error', error);
            if (await fallbackLocalLogin(email, password)) return;
            showToast(error.message || 'Correo o contraseña incorrectos. Intenta de nuevo.', 'danger');
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
        if (await fallbackLocalLogin(email, password)) return;
        showToast('Error de conexión. Intenta nuevamente.', 'danger');
    }
}

async function fallbackLocalLogin(email, password) {
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
    AppState.currentUserId = null;
    AppState.currentUserName = user.name || (user.role === 'admin' ? 'Administrador' : 'Trabajador');
    AppState.currentUserEmail = email;
    AppState.currentBlock = null; // login normal: sin bloque específico
    updateRoleSwitcherVisibility(user.role);

    document.getElementById('login-screen').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    switchRole(user.role);
    updateUserDisplay();
    saveLocalSession();

    if (USE_SUPABASE && supabaseClient) {
        // Cargar tareas primero
        await fetchLatestTasks();
        
        // Luego, si es worker, cargar sus conteos
        if (user.role === 'worker') {
            await fetchWorkerCountsForCurrentUser();
        }
        
        subscribeTaskAssignments();
    }

    if (user.role === 'worker') {
        requestNotificationPermission();
    }

    showToast(`Bienvenido ${user.name}`, 'success');
    return true;
}

async function signInUser(user) {
    const role = await getSupabaseUserRole(user);
    AppState.loggedIn = true;
    AppState.currentRole = role;
    AppState.currentUserId = user?.id || null;
    AppState.currentBlock = null;
    updateRoleSwitcherVisibility(role);

    document.getElementById('login-screen').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    switchRole(role);
    AppState.currentUserName = user?.user_metadata?.full_name || user?.email || (role === 'admin' ? 'Administrador' : 'Trabajador');
    AppState.currentUserEmail = user?.email || '';
    updateUserDisplay();
    saveLocalSession();
    
    // Cargar tareas primero
    await fetchLatestTasks();
    
    // Luego, si es worker, cargar sus conteos
    if (role === 'worker') {
        await fetchWorkerCountsForCurrentUser();
    }
    
    subscribeTaskAssignments();
    showToast(`Bienvenido ${AppState.currentUserName}`, 'success');
}

function updateUserDisplay() {
    try {
        const nameEl = document.getElementById('user-name');
        const emailEl = document.getElementById('user-email');
        const workerWelcome = document.getElementById('worker-welcome-name');
        const blockSuffix = AppState.currentBlock ? ` — Bloque ${AppState.currentBlock}` : '';
        if (nameEl) nameEl.textContent = (AppState.currentUserName || 'Usuario') + blockSuffix;
        if (emailEl) emailEl.textContent = AppState.currentBlock
            ? `Auxiliar · Bloque ${AppState.currentBlock}`
            : (AppState.currentUserEmail || '');
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
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: false,
            detectSessionInUrl: false,
            autoRefreshToken: false
        },
        global: {
            headers: {
                apikey: SUPABASE_ANON_KEY
            }
        }
    });
    supabaseAvailable = true;
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

async function fetchWorkerCounts() {
    if (!supabaseClient || AppState.currentRole !== 'admin') return;
    
    const { data, error } = await supabaseClient
        .from('worker_counts')
        .select('*');
    
    if (error) {
        console.warn('Error fetching worker counts:', error);
        return;
    }
    
    if (data && data.length > 0) {
        // Convertir registros de worker_counts en AppState.counts
        AppState.counts = data.map(record => ({
            item: record.item || { id: record.task_id },
            cajas: record.cajas,
            unidades: record.unidades,
            averias: record.averias,
            workerEmail: record.worker_email,
            workerName: record.worker_name || record.worker_email,
            blockNum: record.block_num || 0
        }));
        saveData();
        updateAdminDashboard();
        renderBlocksLiveProgress();
    } else {
        // Sin conteos, limpiar y actualizar
        AppState.counts = [];
        saveData();
        updateAdminDashboard();
        renderBlocksLiveProgress();
    }
}

async function fetchWorkerCountsForCurrentUser() {
    if (!supabaseClient || AppState.currentRole !== 'worker') return;
    
    console.log('Cargando conteos para:', AppState.currentUserEmail);
    
    const { data, error } = await supabaseClient
        .from('worker_counts')
        .select('*')
        .eq('worker_email', AppState.currentUserEmail);
    
    if (error) {
        console.warn('Error fetching worker counts for current user:', error);
        return;
    }
    
    console.log('Conteos cargados:', data);
    
    if (data && data.length > 0) {
        // Convertir registros de worker_counts en AppState.counts
        AppState.counts = data.map(record => ({
            item: record.item || { id: record.task_id },
            cajas: record.cajas,
            unidades: record.unidades,
            averias: record.averias
        }));
        console.log('AppState.counts actualizado:', AppState.counts);
        saveData();
        renderWorkerTasks();
    } else {
        console.log('No hay conteos previos para este worker');
        AppState.counts = [];
        saveData();
        renderWorkerTasks();
    }
}

async function fetchLatestTasks() {
    if (!supabaseClient) return;

    // Solo cargar tareas publicadas HOY y con status active
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabaseClient
        .from(SUPABASE_TASKS_TABLE)
        .select('id, payload, status, created_at, numBlocks, blocks')
        .eq('status', 'active')
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
    if (error) {
        console.warn('Supabase tasks fetch error', error);
        if (error.status === 401) {
            showToast('401 en task_assignments: revisa las políticas RLS de Supabase.', 'danger');
        }
        return;
    }

    if (data?.length > 0) {
        const latest = data[0];
        if (Array.isArray(latest.payload) && latest.payload.length > 0) {
            AppState.todayTasks = latest.payload.map(task => ({ ...task }));

            // Restaurar bloques desde campo 'blocks'; fallback por _blockNum
            if (latest.blocks && typeof latest.blocks === 'object' && Object.keys(latest.blocks).length) {
                AppState.blocks = latest.blocks;
            } else {
                const rebuilt = {};
                AppState.todayTasks.forEach(t => {
                    const bn = t._blockNum || 1;
                    if (!rebuilt[bn]) rebuilt[bn] = [];
                    rebuilt[bn].push(t);
                });
                AppState.blocks = rebuilt;
            }
            AppState.numBlocks = latest.numBlocks || Object.keys(AppState.blocks).length || 0;
        } else {
            // Payload vacío → admin limpió el día
            AppState.todayTasks = [];
            AppState.blocks = {};
            AppState.counts = [];
        }
    } else {
        // No hay publicación activa hoy → limpiar estado local
        AppState.todayTasks = [];
        AppState.blocks = {};
        AppState.counts = [];
    }

    saveData();
    if (AppState.currentRole === 'worker') renderWorkerTasks();
    if (AppState.currentRole === 'admin') {
        renderAssignTab();
        renderBlocksTab();
    }

    // Cargar conteos del worker en tiempo real
    if (AppState.currentRole === 'admin') {
        await fetchWorkerCounts();
        await fetchHistoryFromSupabase();
    }
}

function subscribeTaskAssignments() {
    if (!supabaseClient || taskSubscription) return;

    const refreshTasks = payload => {
        const newRow = payload?.new;
        refreshTasksState(newRow);
    };
    
    const refreshCounts = payload => {
        // Cargar todos los conteos desde worker_counts
        if (AppState.currentRole === 'admin') {
            fetchWorkerCounts();
        } else if (AppState.currentRole === 'worker') {
            // Worker carga solo sus conteos
            fetchWorkerCountsForCurrentUser();
        }
    };

    taskSubscription = supabaseClient.channel('public:task_assignments')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_assignments' }, refreshTasks)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'task_assignments' }, refreshTasks)
        .subscribe(status => {
            console.log('Task subscription status:', status);
        });
    
    // Suscribirse a cambios en worker_counts para admin y worker
    supabaseClient.channel('public:worker_counts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'worker_counts' }, refreshCounts)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'worker_counts' }, refreshCounts)
        .subscribe();
}

function refreshTasksState(newRow) {
    if (!newRow || !Array.isArray(newRow.payload)) return;
    AppState.todayTasks = newRow.payload.map(task => ({ ...task }));

    // Restaurar bloques desde el campo 'blocks' del payload de realtime
    if (newRow.blocks && typeof newRow.blocks === 'object' && Object.keys(newRow.blocks).length) {
        AppState.blocks = newRow.blocks;
    } else {
        // Fallback: agrupar por _blockNum
        const rebuilt = {};
        AppState.todayTasks.forEach(t => {
            const bn = t._blockNum || 1;
            if (!rebuilt[bn]) rebuilt[bn] = [];
            rebuilt[bn].push(t);
        });
        AppState.blocks = rebuilt;
    }
    AppState.numBlocks = newRow.numBlocks || Object.keys(AppState.blocks).length || 0;

    saveData();
    if (AppState.currentRole === 'worker') renderWorkerTasks();
    if (AppState.currentRole === 'admin') {
        updateAdminDashboard();
        renderAssignTab();
        renderBlocksTab();
    }
    if (AppState.currentRole === 'worker') {
        notifyNewTaskAssignment(AppState.todayTasks.length);
    }
}

async function syncCountsToSupabase() {
    if (!supabaseClient || !navigator.onLine) return false;
    
    let hasError = false;
    // Sincronizar cada conteo como un registro individual en worker_counts
    for (const count of AppState.counts) {
        const { error } = await supabaseClient.from('worker_counts').upsert([{
            task_id: count.item.id,
            worker_email: AppState.currentUserEmail,
            worker_name: AppState.currentUserName || AppState.currentUserEmail,
            block_num: AppState.currentBlock || 0,
            cajas: count.cajas,
            unidades: count.unidades,
            averias: count.averias,
            item: count.item
        }], { onConflict: 'task_id,worker_email' });
        
        if (error) {
            console.warn('Error sincronizando conteo para', count.item.id, ':', error);
            hasError = true;
        }
    }
    return !hasError;
}

async function pushTasksToSupabase() {
    const taskPayload = AppState.todayTasks.map(task => ({ ...task }));
    const taskRecord = {
        payload: taskPayload,
        blocks: AppState.blocks,          // estructura completa { 1: [...], 2: [...] }
        numBlocks: AppState.numBlocks,
        published_by: AppState.currentUserId,
        published_by_email: AppState.currentUserEmail,
        status: 'active'
    };

    if (!supabaseAvailable) {
        AppState.pendingSync.tasks.push(taskRecord);
        saveData();
        showToast('Supabase no está disponible. Guardado localmente.', 'warning');
        return true;
    }

    if (!supabaseClient) {
        AppState.pendingSync.tasks.push(taskRecord);
        saveData();
        showToast('Guardado localmente. Se sincronizará cuando tengas internet.', 'success');
        return true;
    }

    if (!navigator.onLine) {
        AppState.pendingSync.tasks.push(taskRecord);
        saveData();
        showToast('Sin conexión. La tarea se guardó offline y se sincronizará automáticamente.', 'success');
        return true;
    }

    if (USE_SUPABASE_AUTH) {
        const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError || !sessionData?.session) {
            showToast('Debes iniciar sesión en Supabase para publicar tareas.', 'danger');
            return false;
        }
    }

    const { error } = await supabaseClient.from(SUPABASE_TASKS_TABLE).insert([taskRecord]);
    if (error) {
        console.warn('Supabase push tasks error', error);
        if (error.status === 401 || error.code === '42501') {
            supabaseAvailable = false;
            showToast('Sincronización denegada en Supabase. Revisa las políticas RLS de task_assignments.', 'danger');
            return false;
        }

        AppState.pendingSync.tasks.push(taskRecord);
        saveData();
        showToast('Error conectando a Supabase. Se guardó offline y se sincronizará después.', 'warning');
        return true;
    }

    return true;
}

async function loadData() {
    const savedCatalog = localStorage.getItem('ia_catalog');
    const savedTasks = localStorage.getItem('ia_todayTasks');
    const savedHistory = localStorage.getItem('ia_history');
    const savedSync = localStorage.getItem('ia_pendingSync');
    const savedBlocks = localStorage.getItem('ia_blocks');
    const savedNumBlocks = localStorage.getItem('ia_numBlocks');

    // Para conteos: localStorage primero, sessionStorage como respaldo
    let savedCounts = localStorage.getItem('ia_counts');
    if (!savedCounts || savedCounts === '[]') {
        const backup = sessionStorage.getItem('ia_counts_backup');
        if (backup && backup !== '[]') {
            console.warn('localStorage de conteos vacío — restaurando desde sessionStorage backup.');
            savedCounts = backup;
        }
    }

    // Para pendingSync: igual, sessionStorage como respaldo
    let savedSyncFinal = savedSync;
    if (!savedSyncFinal) {
        const backupSync = sessionStorage.getItem('ia_pendingSync_backup');
        if (backupSync) {
            console.warn('localStorage de pendingSync vacío — restaurando desde sessionStorage backup.');
            savedSyncFinal = backupSync;
        }
    }

    AppState.catalog = savedCatalog ? JSON.parse(savedCatalog) : initialCatalog;
    AppState.todayTasks = savedTasks ? JSON.parse(savedTasks) : [];
    AppState.counts = savedCounts ? JSON.parse(savedCounts) : [];
    AppState.history = savedHistory ? JSON.parse(savedHistory) : [];
    AppState.blocks = savedBlocks ? JSON.parse(savedBlocks) : {};
    AppState.numBlocks = savedNumBlocks ? parseInt(savedNumBlocks) : 5;

    const parsedSync = savedSyncFinal ? JSON.parse(savedSyncFinal) : {};
    AppState.pendingSync = {
        tasks: parsedSync.tasks || [],
        history: parsedSync.history || [],
        counts: parsedSync.counts || []
    };

    if (USE_SUPABASE) {
        initSupabase();
        if (USE_SUPABASE_PRODUCTS) {
            await fetchSupabaseProducts();
        }
    }
}

function saveData() {
    localStorage.setItem('ia_catalog', JSON.stringify(AppState.catalog));
    localStorage.setItem('ia_todayTasks', JSON.stringify(AppState.todayTasks));
    localStorage.setItem('ia_counts', JSON.stringify(AppState.counts));
    localStorage.setItem('ia_history', JSON.stringify(AppState.history));
    localStorage.setItem('ia_pendingSync', JSON.stringify(AppState.pendingSync));
    localStorage.setItem('ia_blocks', JSON.stringify(AppState.blocks));
    localStorage.setItem('ia_numBlocks', String(AppState.numBlocks));

    // Segunda copia en sessionStorage como respaldo inmediato contra limpieza de localStorage
    try {
        sessionStorage.setItem('ia_counts_backup', JSON.stringify(AppState.counts));
        sessionStorage.setItem('ia_pendingSync_backup', JSON.stringify(AppState.pendingSync));
    } catch(e) { /* sessionStorage lleno o no disponible — ignorar */ }

    // Worker: sync agresiva en background cada vez que se guarda un conteo
    if (AppState.currentRole === 'worker' && USE_SUPABASE && supabaseClient && navigator.onLine) {
        syncCountsToSupabase().catch(e => console.warn('Background sync error:', e));
    }

    if (AppState.currentRole === 'admin') {
        updateAdminDashboard();
        renderBlocksTab();
    }
}

async function fetchHistoryFromSupabase() {
    if (!supabaseClient || !navigator.onLine) return;
    const { data, error } = await supabaseClient
        .from('inventory_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
    if (error) {
        // Si es error de permisos (RLS), usar historial local silenciosamente
        if (error.code === '42501' || error.status === 401 || error.code === 'PGRST301') {
            console.warn('Sin permiso para leer historial de Supabase. Usando historial local. Ejecuta el SQL de supabase_setup.sql para habilitar SELECT en inventory_history.');
            return;
        }
        console.warn('Error cargando historial desde Supabase:', error);
        return;
    }
    if (data && data.length > 0) {
        AppState.history = data.map(r => ({
            date: r.date,
            name: r.product_name,
            code: r.product_code || '',
            provider: r.provider || '',
            embalaje: r.embalaje || 1,
            precio: r.precio || 0,
            expectedStock: r.expected_stock || 0,
            cajas: r.cajas || 0,
            unidades: r.unidades || 0,
            totalContado: r.total_contado || 0,
            diffUds: r.diff_uds || 0,
            diffValorRaw: r.diff_valor_raw || 0,
            descuadreFormateado: r.descuadre_formateado || '-',
            averias: r.averias || 0
        }));
        saveData();
        renderAdminHistory();
    }
}

async function pushHistoryToSupabase(records) {
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

    if (!supabaseClient || !navigator.onLine) {
        AppState.pendingSync.history.push(...records.map(record => ({ ...record })));
        saveData();
        showToast('Historial guardado localmente. Se sincronizará cuando vuelvas online.', 'success');
        return;
    }

    const { error } = await supabaseClient.from('inventory_history').insert(payload);
    if (error) {
        console.warn('Supabase history insert error', error);
        AppState.pendingSync.history.push(...records.map(record => ({ ...record })));
        saveData();
        showToast('No se pudo sincronizar el historial con Supabase. Se guardó localmente.', 'warning');
    }
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
            .then(reg => {
                console.log('Service Worker registrado:', reg.scope);
                if (reg.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
                return navigator.serviceWorker.getRegistrations();
            })
            .then(registrations => {
                registrations.forEach(reg => {
                    if (reg.waiting) {
                        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                    }
                    if (reg.active && reg.active.scriptURL.includes('sw.js')) {
                        reg.update();
                    }
                });
            })
            .catch(err => {
                console.warn('No se pudo registrar el Service Worker:', err);
            });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    }
}


function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

function hideInstallButtonIfInstalled() {
    const installButton = document.getElementById('btn-install-app');
    if (!installButton) return;
    if (isAppInstalled()) {
        installButton.style.display = 'none';
    }
}

function setupInstallPrompt() {
    const installButton = document.getElementById('btn-install-app');
    if (isAppInstalled()) {
        if (installButton) installButton.style.display = 'none';
        return;
    }

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
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
        renderAssignTab();
        updateAdminDashboard();
        renderAdminHistory();
        renderBlocksTab();
    } else {
        renderWorkerTasks();
    }
}

// ═══════════════════════════════════════════════
//  SISTEMA DE BLOQUES
// ═══════════════════════════════════════════════

/**
 * Reconstruye AppState.todayTasks como la unión ordenada de todos los bloques.
 * todayTasks mantiene _blockNum en cada ítem para saber a qué bloque pertenece.
 */
function rebuildTodayTasksFromBlocks() {
    const all = [];
    const sortedKeys = Object.keys(AppState.blocks).map(Number).sort((a, b) => a - b);
    sortedKeys.forEach(bn => {
        (AppState.blocks[bn] || []).forEach(item => {
            all.push({ ...item, _blockNum: bn });
        });
    });
    AppState.todayTasks = all;
    AppState.numBlocks = sortedKeys.length ? Math.max(...sortedKeys) : 0;
}

/**
 * Limpia todos los productos de un bloque específico.
 */
function clearBlock(blockNum) {
    if (!blockNum) return;
    const count = (AppState.blocks[blockNum] || []).length;
    if (!count) { showToast(`El Bloque ${blockNum} ya está vacío.`, 'info'); return; }
    if (!confirm(`¿Eliminar los ${count} productos del Bloque ${blockNum}?`)) return;

    delete AppState.blocks[blockNum];
    rebuildTodayTasksFromBlocks();
    // Limpiar conteos de ese bloque
    AppState.counts = AppState.counts.filter(c => (c.blockNum || c.item?._blockNum) !== blockNum);
    saveData();
    renderAssignTab();
    renderBlocksTab();
    updateAdminDashboard();
    showToast(`Bloque ${blockNum} eliminado.`, 'success');
}

/** Variable para saber qué bloque está mostrando el panel de detalle */
let currentDetailBlock = null;

/**
 * Renderiza el tab Asignar: resumen de bloques + detalle del bloque activo.
 */
function renderAssignTab() {
    const summary = document.getElementById('assign-blocks-summary');
    if (!summary) return;

    const blockNums = Object.keys(AppState.blocks).map(Number).sort((a, b) => a - b);

    if (!blockNums.length) {
        summary.innerHTML = `
            <div class="text-center text-muted" style="padding:2rem; grid-column:1/-1;">
                <i data-lucide="upload" style="width:32px;height:32px;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;"></i>
                No hay bloques cargados. Selecciona un bloque, un proveedor y carga su Excel.
            </div>`;
        lucide.createIcons();
        // Ocultar detalle
        const detail = document.getElementById('assign-block-detail');
        if (detail) detail.style.display = 'none';
        currentDetailBlock = null;
        return;
    }

    summary.innerHTML = '';
    blockNums.forEach(bn => {
        const items = AppState.blocks[bn] || [];
        const counted = items.filter(t => AppState.counts.find(c => c.item.id === t.id)).length;
        const pct = items.length > 0 ? Math.round((counted / items.length) * 100) : 0;

        const card = document.createElement('div');
        card.className = `assign-block-card ${pct === 100 ? 'block-done' : ''} ${currentDetailBlock === bn ? 'active-detail' : ''}`;
        card.innerHTML = `
            <div class="assign-block-card-header">
                <span class="block-badge">Bloque ${bn}</span>
                <span class="assign-block-count">${items.length} productos</span>
            </div>
            <div class="block-card-progress-bar" style="margin:8px 0;">
                <div class="block-card-progress-fill" style="width:${pct}%"></div>
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:8px;">${counted}/${items.length} contados · ${pct}%</div>
            <div class="assign-block-actions">
                <button class="btn btn-secondary btn-sm" onclick="showBlockDetail(${bn})">
                    <i data-lucide="eye"></i> Ver productos
                </button>
                <button class="btn btn-danger btn-sm" onclick="clearBlock(${bn})">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
        summary.appendChild(card);
    });
    lucide.createIcons();

    // Si ya hay un bloque activo en detalle, refrescarlo
    if (currentDetailBlock && AppState.blocks[currentDetailBlock]) {
        renderBlockDetail();
    } else if (blockNums.length) {
        // Mostrar el primer bloque por defecto
        showBlockDetail(blockNums[0]);
    }
}

/**
 * Muestra el panel de detalle de un bloque específico.
 */
function showBlockDetail(blockNum) {
    currentDetailBlock = blockNum;
    const detail = document.getElementById('assign-block-detail');
    if (detail) detail.style.display = 'block';

    // Resaltar la tarjeta activa — esperar al siguiente tick para que el DOM esté listo
    requestAnimationFrame(() => {
        document.querySelectorAll('.assign-block-card').forEach(c => c.classList.remove('active-detail'));
        const blockNums = Object.keys(AppState.blocks).map(Number).sort((a, b) => a - b);
        const idx = blockNums.indexOf(Number(blockNum));
        const cards = document.querySelectorAll('.assign-block-card');
        if (cards[idx]) cards[idx].classList.add('active-detail');
    });

    renderBlockDetail();
}

/**
 * Renderiza la tabla de productos del bloque activo en el panel de detalle.
 */
function renderBlockDetail() {
    if (!currentDetailBlock) return;
    const items = AppState.blocks[currentDetailBlock] || [];
    const searchTerm = (document.getElementById('block-detail-search')?.value || '').toLowerCase();

    const title = document.getElementById('assign-detail-title');
    const subtitle = document.getElementById('assign-detail-subtitle');
    if (title) title.textContent = `Bloque ${currentDetailBlock} — Productos`;
    if (subtitle) subtitle.textContent = `${items.length} producto${items.length !== 1 ? 's' : ''} cargado${items.length !== 1 ? 's' : ''}`;

    const tbody = document.getElementById('block-detail-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = items.filter(t =>
        !searchTerm ||
        t.name.toLowerCase().includes(searchTerm) ||
        (t.code || '').toLowerCase().includes(searchTerm)
    );

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No hay productos que coincidan.</td></tr>`;
        return;
    }

    filtered.forEach((item, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color:var(--text-muted); font-size:0.8rem;">${i + 1}</td>
            <td><strong>${item.name}</strong></td>
            <td><span class="product-code-tag">${item.code || '—'}</span></td>
            <td><span class="provider-badge ${item.provider || ''}">${item.provider || '—'}</span></td>
            <td>${item.embalaje || 1}</td>
            <td>${item.expectedStock || 0}</td>
            <td>
                <button class="btn btn-danger btn-sm" onclick="removeItemFromBlock('${item.id}', ${currentDetailBlock})">
                    <i data-lucide="x"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

/**
 * Quita un producto individual de un bloque.
 */
function removeItemFromBlock(itemId, blockNum) {
    if (!AppState.blocks[blockNum]) return;
    AppState.blocks[blockNum] = AppState.blocks[blockNum].filter(t => t.id !== itemId);
    if (AppState.blocks[blockNum].length === 0) delete AppState.blocks[blockNum];
    AppState.counts = AppState.counts.filter(c => c.item.id !== itemId);
    rebuildTodayTasksFromBlocks();
    saveData();
    renderAssignTab();
    renderBlocksTab();
    updateAdminDashboard();
}

/**
 * (Mantenida por compatibilidad — ya no redistribuye automáticamente)
 * Ahora solo reconstruye todayTasks desde blocks.
 */
function distributeIntoBlocks(tasks, numBlocks) {
    // Función legacy — el nuevo sistema usa AppState.blocks directamente.
    // Se conserva para no romper llamadas en fetchLatestTasks/refreshTasksState
    // que reconstruyen bloques desde el payload de Supabase.
    const n = Math.max(1, parseInt(numBlocks) || 1);
    const distribution = {};
    for (let i = 1; i <= n; i++) distribution[i] = [];
    tasks.forEach((task, index) => {
        // Si el task tiene _blockNum ya asignado (viene de Supabase), respetarlo
        const bn = task._blockNum || ((index % n) + 1);
        if (!distribution[bn]) distribution[bn] = [];
        distribution[bn].push({ ...task, _blockNum: bn });
    });
    return distribution;
}

function redistributeBlocks() {
    // Ya no se usa — dejada vacía para no romper si algo la llama
}

// ═══════════════════════════════════════════════

/** Renderiza el tab de Bloques en la vista admin (overview + live progress) */
function renderBlocksTab() {
    const grid = document.getElementById('blocks-overview-grid');
    if (!grid) return;

    const blockNums = Object.keys(AppState.blocks).map(Number).sort((a, b) => a - b);

    if (!blockNums.length) {
        grid.innerHTML = '<div class="text-center text-muted" style="grid-column:1/-1; padding:2rem;">Carga los Excel de cada bloque para ver el resumen aquí.</div>';
        renderBlocksLiveProgress();
        return;
    }

    grid.innerHTML = '';
    blockNums.forEach(bn => {
        const items = AppState.blocks[bn] || [];
        const countedInBlock = items.filter(t => AppState.counts.find(c => c.item.id === t.id)).length;
        const pct = items.length > 0 ? Math.round((countedInBlock / items.length) * 100) : 0;

        const card = document.createElement('div');
        card.className = `block-overview-card ${pct === 100 ? 'block-done' : ''}`;
        card.innerHTML = `
            <div class="block-card-header">
                <span class="block-badge">Bloque ${bn}</span>
                <span class="block-card-count">${items.length} productos</span>
            </div>
            <div class="block-card-progress-bar">
                <div class="block-card-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="block-card-footer">
                <span class="${pct === 100 ? 'text-teal' : 'text-muted'}">${countedInBlock} / ${items.length} contados (${pct}%)</span>
            </div>
            <div class="block-card-products">
                ${items.slice(0, 3).map(t => `<span class="block-product-chip">${t.name}</span>`).join('')}
                ${items.length > 3 ? `<span class="block-product-chip text-muted">+${items.length - 3} más...</span>` : ''}
            </div>
        `;
        grid.appendChild(card);
    });

    renderBlocksLiveProgress();
}

/** Renderiza el panel de avance en tiempo real por bloque */
function renderBlocksLiveProgress() {
    const container = document.getElementById('blocks-live-progress');
    if (!container) return;

    if (!Object.keys(AppState.blocks).length) {
        container.innerHTML = '<div class="text-center text-muted" style="padding:2rem;">Esperando conteos de los auxiliares...</div>';
        return;
    }

    container.innerHTML = '';

    // Agrupar conteos por bloque
    const countsByBlock = {};
    AppState.counts.forEach(c => {
        const bn = c.blockNum || 0;
        if (!countsByBlock[bn]) countsByBlock[bn] = [];
        countsByBlock[bn].push(c);
    });

    Object.entries(AppState.blocks).forEach(([blockNum, items]) => {
        const blockCounts = countsByBlock[parseInt(blockNum)] || [];
        const countedIds = new Set(blockCounts.map(c => c.item.id));
        const countedInBlock = items.filter(t => countedIds.has(t.id)).length;
        const pct = items.length > 0 ? Math.round((countedInBlock / items.length) * 100) : 0;

        // Auxiliares que han contado en este bloque
        const workerNames = [...new Set(blockCounts.map(c => c.workerName || c.workerEmail || 'Auxiliar'))];

        const row = document.createElement('div');
        row.className = `block-live-row ${pct === 100 ? 'block-live-done' : ''}`;
        row.innerHTML = `
            <div class="block-live-label">
                <span class="block-badge-sm">B${blockNum}</span>
                <span class="block-live-workers">${workerNames.length ? workerNames.join(', ') : '<em>Sin auxiliar aún</em>'}</span>
            </div>
            <div class="block-live-bar-wrap">
                <div class="block-live-bar">
                    <div class="block-live-fill" style="width:${pct}%"></div>
                </div>
                <span class="block-live-pct">${countedInBlock}/${items.length} · ${pct}%</span>
            </div>
        `;
        container.appendChild(row);
    });
}

/** Publicar tareas con bloques — delegado a publishDailyTask (mantiene compatibilidad con onclick) */
async function publishWithBlocks() {
    return publishDailyTask();
}

// ═══════════════════════════════════════════════

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

    // Re-renderizar el contenido del tab al activarlo
    if (tabId === 'assign') renderAssignTab();
    if (tabId === 'blocks') renderBlocksTab();
    if (tabId === 'monitor') updateAdminDashboard();
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
        let itemsMap = {};
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
                const codeStr = String(codigo).trim();
                const stockVal = parseInt(cantidad) || 0;
                const priceVal = parseFloat(String(precio).replace(',', '.')) || 0;
                const embVal = parseInt(embalaje) || 1;

                if (itemsMap[codeStr]) {
                    itemsMap[codeStr].expectedStock += stockVal;
                    if (String(nombre).length > itemsMap[codeStr].name.length) {
                        itemsMap[codeStr].name = String(nombre);
                    }
                } else {
                    itemsMap[codeStr] = {
                        id: 'ext-' + Date.now() + '-' + index,
                        code: codeStr,
                        name: String(nombre),
                        embalaje: embVal,
                        expectedStock: stockVal,
                        precio: priceVal,
                        provider: selectedProvider
                    };
                }
            }
        });

        newItems = Object.values(itemsMap);

        if (newItems.length > 0) {
            // ── NUEVO FLUJO: asignar al bloque seleccionado ──
            const targetBlock = parseInt(document.getElementById('excel-block-select')?.value) || 1;

            // Marcar cada ítem con su bloque y añadir al catálogo (merge único por código)
            const stampedItems = newItems.map(item => ({ ...item, _blockNum: targetBlock }));
            AppState.catalog = [...AppState.catalog, ...stampedItems]
                .filter((v, i, a) => a.findIndex(v2 => v2.code === v.code) === i);

            // Añadir/reemplazar los productos de este bloque (permite recargar el mismo bloque)
            if (!AppState.blocks[targetBlock]) {
                AppState.blocks[targetBlock] = [];
            }
            // Merge: si el producto ya existe en este bloque, actualizarlo; si no, añadirlo
            stampedItems.forEach(item => {
                const idx = AppState.blocks[targetBlock].findIndex(t => t.code === item.code);
                if (idx >= 0) {
                    AppState.blocks[targetBlock][idx] = item;
                } else {
                    AppState.blocks[targetBlock].push(item);
                }
            });

            // todayTasks = unión de todos los bloques (fuente de verdad para el resto del sistema)
            rebuildTodayTasksFromBlocks();

            saveData();
            renderAssignTab();
            renderBlocksTab();
            showToast(`¡Excel cargado! ${newItems.length} productos asignados al Bloque ${targetBlock}.`, 'success');

            // Avanzar el selector al siguiente bloque para facilitar la carga secuencial
            const blockSelect = document.getElementById('excel-block-select');
            if (blockSelect && targetBlock < 10) blockSelect.value = String(targetBlock + 1);
        } else {
            showToast('No se encontraron columnas de "Código" y "Nombre" en el archivo.', 'danger');
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = ''; // Reset input
}

function renderAdminCatalog() { /* obsoleta — reemplazada por renderAssignTab */ }
function filterCatalogByProvider() { /* obsoleta */ }
function handleCatalogSearch() { /* obsoleta */ }
function toggleTaskAssignment() { /* obsoleta */ }
function deleteAssignedTask() { /* obsoleta — usar removeItemFromBlock */ }

async function deleteSelectedTasks() {
    if (AppState.todayTasks.length === 0) {
        showToast('No hay tareas asignadas para eliminar.', 'danger');
        return;
    }

    // Verificar conteos activos en Supabase antes de borrar
    if (USE_SUPABASE && supabaseClient && navigator.onLine) {
        try {
            const { data: existingCounts, error: countErr } = await supabaseClient
                .from('worker_counts')
                .select('task_id, worker_email, cajas, unidades');

            if (!countErr && existingCounts && existingCounts.length > 0) {
                const workers = [...new Set(existingCounts.map(r => r.worker_email))];
                const proceed = confirm(
                    `⚠️ Hay ${existingCounts.length} conteo(s) activos de ${workers.length} trabajador(es):\n` +
                    `  ${workers.join(', ')}\n\n` +
                    'Eliminar las tareas borrará estos conteos sin guardarlos.\n\n' +
                    '¿Deseas continuar de todas formas?'
                );
                if (!proceed) return;
            }
        } catch (e) {
            console.warn('Error verificando conteos activos antes de eliminar tareas:', e);
        }
    }

    if (!confirm('¿Eliminar todas las tareas asignadas para hoy?')) return;

    AppState.todayTasks = [];
    AppState.counts = [];
    AppState.blocks = {};
    saveData();
    renderAssignTab();
    updateAdminDashboard();
    renderBlocksTab();

    if (USE_SUPABASE && supabaseClient) {
        const published = await pushTasksToSupabase();
        try {
            await supabaseClient.from('worker_counts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } catch (e) {
            console.warn('Error al borrar conteos activos en Supabase:', e);
        }
        if (published) {
            showToast('Tareas eliminadas y sincronizadas al trabajador.', 'success');
        } else {
            showToast('Tareas eliminadas localmente. Se sincronizará cuando haya conexión.', 'warning');
        }
        return;
    }

    showToast('Tareas eliminadas localmente. Se sincronizará cuando haya conexión.', 'success');
}

async function publishDailyTask() {
    const blockNums = Object.keys(AppState.blocks).map(Number).sort((a, b) => a - b);
    if (!blockNums.length) {
        showToast('No hay bloques cargados. Carga al menos un Excel primero.', 'danger');
        return;
    }

    // Resumen de lo que se va a publicar
    const blockSummary = blockNums.map(bn => `  • Bloque ${bn}: ${(AppState.blocks[bn] || []).length} productos`).join('\n');

    // Verificar si ya hay conteos activos en Supabase antes de sobrescribir
    if (USE_SUPABASE && supabaseClient && navigator.onLine) {
        try {
            const { count, error: countErr } = await supabaseClient
                .from('worker_counts')
                .select('*', { count: 'exact', head: true });
            if (!countErr && count > 0) {
                const proceed = confirm(
                    `⚠️ Hay ${count} conteo(s) activos en curso.\n\n` +
                    'Publicar nuevos bloques borrará esos conteos sin guardarlos en el historial.\n\n' +
                    '¿Deseas continuar de todas formas?'
                );
                if (!proceed) return;
            }
        } catch (e) {
            console.warn('Error verificando conteos activos antes de publicar:', e);
        }
    }

    AppState.counts = [];
    saveData();

    if (USE_SUPABASE && supabaseClient) {
        const published = await pushTasksToSupabase();
        if (!published) return;
        try {
            await supabaseClient.from('worker_counts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } catch (e) {
            console.warn('Error al borrar conteos activos en Supabase al publicar:', e);
        }
    }

    showToast(`✅ Publicado: ${blockNums.length} bloque(s), ${AppState.todayTasks.length} productos en total.`, 'success');
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

    // ── Renderizar tabla agrupada por bloques ──
    const monitorContainer = document.getElementById('monitor-blocks-container');
    if (monitorContainer) {
        monitorContainer.innerHTML = '';

        const blockNums = Object.keys(AppState.blocks).map(Number).sort((a, b) => a - b);

        if (!blockNums.length) {
            monitorContainer.innerHTML = '<p class="text-muted text-center" style="padding:2rem;">No se han publicado bloques para hoy.</p>';
        } else {
            blockNums.forEach(bn => {
                const blockItems = AppState.blocks[bn] || [];
                // Conteos de ESTE bloque
                const blockCounts = AppState.counts.filter(c =>
                    blockItems.some(t => t.id === c.item.id)
                );
                const countedInBlock = blockCounts.length;
                const totalInBlock = blockItems.length;
                const pct = totalInBlock > 0 ? Math.round((countedInBlock / totalInBlock) * 100) : 0;
                const allDone = countedInBlock === totalInBlock && totalInBlock > 0;

                // Auxiliares que contaron en este bloque
                const workers = [...new Set(blockCounts.map(c => c.workerName || c.workerEmail || 'Auxiliar').filter(Boolean))];

                // Acumular totales globales
                let blockDiffUds = 0, blockDiffValor = 0, blockAverias = 0;
                blockCounts.forEach(c => {
                    const emb = c.item.embalaje || 1;
                    const total = (parseInt(c.cajas) * emb) + parseInt(c.unidades);
                    const diff = total - (c.item.expectedStock || 0);
                    blockDiffUds += diff;
                    blockDiffValor += diff * (c.item.precio || 0);
                    blockAverias += parseInt(c.averias) || 0;
                });
                grandDiffUds += blockDiffUds;
                grandDiffValor += blockDiffValor;
                totalAverias += blockAverias;

                // Construir sección de bloque
                const section = document.createElement('div');
                section.className = `monitor-block-section ${allDone ? 'monitor-block-done' : ''}`;
                section.style.marginBottom = '1.25rem';

                const fmtBlockValor = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(blockDiffValor);

                section.innerHTML = `
                    <div class="monitor-block-header">
                        <div class="monitor-block-info">
                            <span class="block-badge">Bloque ${bn}</span>
                            <span class="monitor-block-worker">${workers.length ? workers.join(', ') : '<em style="color:var(--text-muted)">Sin auxiliar aún</em>'}</span>
                            <span class="monitor-block-progress-text">${countedInBlock}/${totalInBlock} · ${pct}%</span>
                        </div>
                        <div class="monitor-block-actions">
                            ${allDone
                                ? `<button class="btn btn-success btn-sm" onclick="finishBlock(${bn})">
                                       <i data-lucide="file-check"></i> Finalizar Bloque ${bn}
                                   </button>`
                                : `<span class="text-muted" style="font-size:0.8rem;">Esperando conteos...</span>`
                            }
                        </div>
                    </div>
                    <div class="monitor-block-bar">
                        <div class="monitor-block-fill" style="width:${pct}%"></div>
                    </div>
                    <div class="table-responsive" style="margin-top:0.5rem;">
                        <table class="data-table" id="monitor-block-table-${bn}">
                            <thead>
                                <tr>
                                    <th>Producto</th>
                                    <th>Emb.</th>
                                    <th>Inv.</th>
                                    <th>Contado</th>
                                    <th>Descuadre ($)</th>
                                    <th>Averías</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                `;
                monitorContainer.appendChild(section);

                // Llenar la tabla de este bloque
                const tbody = section.querySelector('tbody');
                if (blockCounts.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:0.75rem;">Sin conteos aún</td></tr>`;
                } else {
                    blockCounts.forEach(countInfo => {
                        const emb = countInfo.item.embalaje || 1;
                        const prec = countInfo.item.precio || 0;
                        const totalContado = (parseInt(countInfo.cajas) * emb) + parseInt(countInfo.unidades);
                        const expected = countInfo.item.expectedStock || 0;
                        const diffUds = totalContado - expected;
                        const diffValor = diffUds * prec;

                        let diffHtml = diffUds !== 0
                            ? `<br><span style="color:${diffUds>0?'#059669':'#ef4444'};font-size:0.75rem">${diffUds>0?'+':''}${diffUds} uds</span>`
                            : '';
                        let valorHtml = '-';
                        if (diffValor !== 0) {
                            const fv = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(diffValor);
                            valorHtml = `<span style="color:${diffValor>0?'#059669':'#ef4444'};font-weight:bold;font-size:0.85rem">${fv}</span>`;
                        }

                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td><strong>${countInfo.item.name}</strong><br><span style="font-size:0.72rem;color:var(--text-muted)">${countInfo.item.code || ''}</span></td>
                            <td>${emb}</td>
                            <td>${expected}</td>
                            <td><strong>${totalContado}</strong>${diffHtml}</td>
                            <td>${valorHtml}</td>
                            <td class="${countInfo.averias > 0 ? 'text-red' : ''}"><strong>${countInfo.averias}</strong></td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
            });
        }
        lucide.createIcons();
    }

    // ── Métricas superiores ──
    document.getElementById('admin-metric-alerts').textContent = totalAverias;
    const fmtGrandValor = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(grandDiffValor);
    const diffUdsEl = document.getElementById('monitor-total-diff-uds');
    const diffValorEl = document.getElementById('monitor-total-diff-valor');
    const averiasEl = document.getElementById('monitor-total-averias');
    if (diffUdsEl) { diffUdsEl.textContent = (grandDiffUds > 0 ? '+' : '') + grandDiffUds; diffUdsEl.style.color = grandDiffUds === 0 ? '' : (grandDiffUds > 0 ? '#059669' : '#ef4444'); }
    if (diffValorEl) { diffValorEl.textContent = fmtGrandValor; diffValorEl.style.color = grandDiffValor === 0 ? '' : (grandDiffValor > 0 ? '#059669' : '#ef4444'); }
    if (averiasEl) averiasEl.textContent = totalAverias;

    // ── Botón "Finalizar Día Completo" solo si todos los bloques están listos ──
    const blockNums = Object.keys(AppState.blocks).map(Number);
    const allBlocksDone = blockNums.length > 0 && blockNums.every(bn => {
        const items = AppState.blocks[bn] || [];
        return items.length > 0 && items.every(t => AppState.counts.find(c => c.item.id === t.id));
    });
    const btnFinishAll = document.getElementById('btn-finish-all');
    const pendingBadge = document.getElementById('monitor-blocks-pending-badge');
    const pendingBlocks = blockNums.filter(bn => {
        const items = AppState.blocks[bn] || [];
        return !items.every(t => AppState.counts.find(c => c.item.id === t.id));
    });
    if (btnFinishAll) btnFinishAll.style.display = blockNums.length > 0 ? '' : 'none';
    if (pendingBadge) {
        if (pendingBlocks.length > 0) {
            pendingBadge.style.display = '';
            pendingBadge.textContent = `${pendingBlocks.length} bloque(s) sin completar`;
        } else {
            pendingBadge.style.display = 'none';
        }
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
        // Formato Supabase: yyyy-mm-dd → ya está listo
        if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
            return dateStr.slice(0, 10);
        }
        // Formato local es-CO: d/m/yyyy o dd/mm/yyyy
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const d = String(parts[0]).padStart(2, '0');
            const m = String(parts[1]).padStart(2, '0');
            const y = parts[2];
            return `${y}-${m}-${d}`;
        }
        return null;
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

// ── Finalizar un bloque individual ──
window.finishBlock = async function(blockNum) {
    const blockItems = AppState.blocks[blockNum] || [];
    if (!blockItems.length) {
        showToast(`El Bloque ${blockNum} no tiene productos.`, 'danger');
        return;
    }

    // Verificar que todos los productos del bloque estén contados
    const uncounted = blockItems.filter(t => !AppState.counts.find(c => c.item.id === t.id));
    if (uncounted.length > 0) {
        const proceed = confirm(
            `⚠️ El Bloque ${blockNum} tiene ${uncounted.length} producto(s) sin contar.\n\n` +
            'Los productos sin conteo quedarán en 0.\n\n¿Deseas finalizar el bloque igualmente?'
        );
        if (!proceed) return;
    }

    // Traer conteos frescos de Supabase para este bloque antes de cerrar
    if (USE_SUPABASE && supabaseClient && navigator.onLine) {
        try {
            const taskIds = blockItems.map(t => t.id);
            const { data: freshCounts, error } = await supabaseClient
                .from('worker_counts')
                .select('*')
                .in('task_id', taskIds);
            if (!error && freshCounts?.length) {
                freshCounts.forEach(record => {
                    const idx = AppState.counts.findIndex(c => c.item?.id === record.task_id);
                    const entry = {
                        item: record.item || { id: record.task_id },
                        cajas: record.cajas,
                        unidades: record.unidades,
                        averias: record.averias,
                        workerName: record.worker_name,
                        workerEmail: record.worker_email,
                        blockNum: record.block_num
                    };
                    if (idx >= 0) AppState.counts[idx] = entry;
                    else AppState.counts.push(entry);
                });
            }
        } catch (e) {
            console.warn('Error obteniendo conteos frescos del bloque:', e);
        }
    }

    const dateStr = new Date().toLocaleDateString('es-CO');
    const dateFile = new Date().toISOString().slice(0, 10);

    // Construir records solo del bloque
    const blockRecords = blockItems.map(item => {
        const countEntry = AppState.counts.find(c => c.item.id === item.id);
        const cajas    = countEntry ? parseInt(countEntry.cajas)    || 0 : 0;
        const unidades = countEntry ? parseInt(countEntry.unidades) || 0 : 0;
        const averias  = countEntry ? parseInt(countEntry.averias)  || 0 : 0;
        const emb = item.embalaje || 1;
        const totalContado = (cajas * emb) + unidades;
        const diff = totalContado - (item.expectedStock || 0);
        const diffValor = diff * (item.precio || 0);
        const fmtVal = diffValor !== 0
            ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(diffValor)
            : '-';
        const record = {
            date: dateStr,
            name: item.name,
            code: item.code,
            provider: item.provider,
            embalaje: emb,
            precio: item.precio || 0,
            expectedStock: item.expectedStock || 0,
            cajas, unidades, totalContado,
            diffUds: diff, diffValorRaw: diffValor,
            descuadreFormateado: fmtVal, averias,
            blockNum
        };
        AppState.history.push(record);
        return record;
    });

    // PDF y Excel del bloque
    try {
        generatePDF(blockRecords, dateStr, `${dateFile}_B${blockNum}`, `Bloque ${blockNum}`);
    } catch (e) {
        console.warn('Error generando PDF del bloque:', e);
        showToast('Error al generar PDF. Revisa la consola.', 'danger');
    }
    await generateExcel(blockRecords, `${dateFile}_B${blockNum}`);

    if (USE_SUPABASE) {
        await pushHistoryToSupabase(blockRecords);
    }

    // Limpiar solo este bloque del estado
    const blockTaskIds = new Set(blockItems.map(t => t.id));
    AppState.counts = AppState.counts.filter(c => !blockTaskIds.has(c.item.id));
    delete AppState.blocks[blockNum];
    rebuildTodayTasksFromBlocks();
    saveData();

    // Borrar conteos de este bloque en Supabase
    if (USE_SUPABASE && supabaseClient) {
        try {
            await supabaseClient
                .from('worker_counts')
                .delete()
                .in('task_id', [...blockTaskIds]);
        } catch (e) {
            console.warn('Error borrando conteos del bloque en Supabase:', e);
        }
    }

    // Actualizar publicación (el bloque desaparece para los auxiliares)
    if (USE_SUPABASE && supabaseClient) {
        await pushTasksToSupabase();
    }

    renderAdminHistory();
    updateAdminDashboard();
    renderAssignTab();
    renderBlocksTab();
    showToast(`✅ Bloque ${blockNum} finalizado. PDF y Excel generados.`, 'success');
};

// Finalizar día: guardar en historial y generar PDF
window.finishDay = async function() {
    if (AppState.todayTasks.length === 0) {
        showToast('No hay productos asignados para finalizar.', 'danger');
        return;
    }

    // Antes de cerrar: traer los conteos más recientes de Supabase para que el PDF
    // incluya lo que los workers hayan enviado (incluso desde otros dispositivos).
    if (USE_SUPABASE && supabaseClient && navigator.onLine) {
        showToast('Obteniendo conteos actualizados antes de cerrar el día...', 'info');
        try {
            const { data: freshCounts, error: fetchErr } = await supabaseClient
                .from('worker_counts')
                .select('*');

            if (fetchErr) {
                console.warn('Error obteniendo conteos finales desde Supabase:', fetchErr);
                // No bloqueamos — usamos los conteos locales que tengamos
            } else if (freshCounts && freshCounts.length > 0) {
                // Fusionar: los conteos de Supabase tienen precedencia sobre los locales
                freshCounts.forEach(record => {
                    const idx = AppState.counts.findIndex(c => c.item && c.item.id === record.task_id);
                    const freshEntry = {
                        item: record.item || { id: record.task_id },
                        cajas: record.cajas,
                        unidades: record.unidades,
                        averias: record.averias
                    };
                    if (idx >= 0) {
                        AppState.counts[idx] = freshEntry;
                    } else {
                        AppState.counts.push(freshEntry);
                    }
                });
                saveData();
            }

            // Verificar si hay tareas sin ningún conteo — posible worker offline
            const taskIdsWithCounts = new Set((freshCounts || []).map(r => r.task_id));
            const tasksWithoutCount = AppState.todayTasks.filter(t => !taskIdsWithCounts.has(t.id));

            if (tasksWithoutCount.length > 0) {
                // Agrupar por proveedor para mostrar cuántos productos faltan
                const missingByProvider = {};
                tasksWithoutCount.forEach(t => {
                    const prov = t.provider || 'sin proveedor';
                    missingByProvider[prov] = (missingByProvider[prov] || 0) + 1;
                });
                const detail = Object.entries(missingByProvider)
                    .map(([prov, n]) => `  • ${prov}: ${n} producto(s)`)
                    .join('\n');

                const proceed = confirm(
                    `⚠️ ATENCIÓN: ${tasksWithoutCount.length} producto(s) NO tienen conteo registrado:\n\n` +
                    `${detail}\n\n` +
                    'Esto puede significar que algún trabajador no ha sincronizado sus conteos todavía.\n\n' +
                    '¿Deseas cerrar el día igualmente? Los productos sin conteo quedarán en 0.'
                );
                if (!proceed) return;
            }
        } catch (e) {
            console.warn('Error inesperado al obtener conteos finales:', e);
        }
    } else if (!navigator.onLine) {
        // Advertir si hay conteos en la cola pendiente que aún no llegaron al servidor
        if (AppState.pendingSync.counts.length > 0) {
            const proceed = confirm(
                `⚠️ Hay ${AppState.pendingSync.counts.length} conteo(s) pendientes de sincronizar.\n\n` +
                'Si cierras el día ahora puede que algunos conteos no estén incluidos en el PDF.\n\n' +
                '¿Deseas continuar de todas formas?'
            );
            if (!proceed) return;
        }
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

    try {
        generatePDF(dayRecords, dateStr, dateFile);
    } catch (e) {
        console.warn('Error generating PDF:', e);
        showToast('Error al generar PDF. Revisa la consola.', 'danger');
    }
    await generateExcel(dayRecords, dateFile);

    if (USE_SUPABASE) {
        await pushHistoryToSupabase(dayRecords);
    }

    AppState.counts = [];
    AppState.todayTasks = [];
    AppState.blocks = {};
    saveData();

    if (USE_SUPABASE && supabaseClient) {
        try {
            // Sincronizar la lista de tareas vacía para limpiar en los trabajadores
            await pushTasksToSupabase();
            
            // Borrar todos los conteos activos en Supabase
            await supabaseClient.from('worker_counts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } catch (e) {
            console.warn('Error al limpiar datos del día en Supabase:', e);
        }
    }

    renderAdminHistory();
    updateAdminDashboard();
    renderAssignTab();
    renderBlocksTab();
    showToast('Día finalizado. PDF generado, descargado y base de datos limpia.', 'success');
}

function getJsPDFCtor() {
    return window.jsPDF || window.jspdf?.jsPDF || window.jspdf || null;
}

function generatePDF(records, dateStr, dateFile, blockLabel) {
    const jsPDFCtor = getJsPDFCtor();
    if (!jsPDFCtor) {
        showToast('No se pudo cargar la librería jsPDF. Abre la app desde un servidor HTTP o revisa los archivos locales.', 'danger');
        return;
    }

    const doc = new jsPDFCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const providerName = records.length > 0 ? (records[0].provider || 'Proveedor no definido').toUpperCase() : 'SIN PROVEEDOR';

    const displayDate = (() => {
        try {
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

    // Si viene con blockLabel usa ese título, si no usa el proveedor
    const titleText = blockLabel
        ? `INVENTARIO ${blockLabel.toUpperCase()} — ${displayDate}`
        : `INVENTARIO ${providerName} ${displayDate}`;

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

// --- Export Excel Generation ---
function generateExcel(records, dateFile) {
    if (typeof XLSX === 'undefined') {
        showToast('Librería XLSX no disponible. No se pudo generar el Excel.', 'danger');
        return;
    }
    // Convert records to sheet data
    const data = records.map(r => ({
        'Producto': r.name,
        'Código': r.code,
        'Emb.': r.embalaje,
        'Inv. Excel': r.expectedStock,
        'Cajas': r.cajas,
        'Uds': r.unidades,
        'Total': r.totalContado,
        'Dif. Uds': r.diffUds,
        'Dif. Valor ($)': r.descuadreFormateado,
        'Averías': r.averias
    }));
    // Add totals row
    const totalDiffValorRaw = records.reduce((s, r) => s + (parseFloat(r.diffValorRaw) || 0), 0);
    const fmtTotal = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(totalDiffValorRaw);
    data.push({
        'Producto': 'Totales',
        'Código': '',
        'Emb.': '',
        'Inv. Excel': '',
        'Cajas': '',
        'Uds': '',
        'Total': '',
        'Dif. Uds': '',
        'Dif. Valor ($)': fmtTotal,
        'Averías': ''
    });

    const ws = XLSX.utils.json_to_sheet(data, { origin: 'A1' });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    // Set column widths for better readability
    const wscols = [
        { wch: 30 }, // Producto
        { wch: 15 }, // Código
        { wch: 8 },  // Emb.
        { wch: 12 }, // Inv. Excel
        { wch: 8 },  // Cajas
        { wch: 8 },  // Uds
        { wch: 10 }, // Total
        { wch: 10 }, // Dif. Uds
        { wch: 15 }, // Dif. Valor ($)
        { wch: 10 }  // Averías
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `Inventario_DECHSS_${dateFile}.xlsx`);
}


// --- Lógica TRABAJADOR ---

function handleWorkerSearch() {
    renderWorkerTasks();
}

function renderWorkerTasks() {
    const list = document.getElementById('worker-task-list');
    const emptyState = document.getElementById('worker-empty-state');
    const blockBanner = document.getElementById('worker-block-banner');

    // Obtener las tareas de este worker según su bloque
    let myTasks = AppState.todayTasks;
    if (AppState.currentBlock) {
        // Si los bloques no están en memoria pero hay tareas, reconstruirlos desde _blockNum
        if (!Object.keys(AppState.blocks).length && AppState.todayTasks.length > 0) {
            const rebuilt = {};
            AppState.todayTasks.forEach(t => {
                const bn = t._blockNum || 1;
                if (!rebuilt[bn]) rebuilt[bn] = [];
                rebuilt[bn].push(t);
            });
            AppState.blocks = rebuilt;
        }
        // Filtrar solo las tareas del bloque asignado
        const blockItems = AppState.blocks[AppState.currentBlock] || [];
        const blockIds = new Set(blockItems.map(t => t.id));
        myTasks = AppState.todayTasks.filter(t => blockIds.has(t.id));

        // Actualizar banner de bloque
        if (blockBanner) {
            blockBanner.style.display = 'flex';
            const badge = document.getElementById('worker-block-badge');
            const title = document.getElementById('worker-block-title');
            const range = document.getElementById('worker-block-range');
            const progressText = document.getElementById('worker-block-progress-text');
            const progressBar = document.getElementById('worker-block-progress-bar');

            if (badge) badge.textContent = `B${AppState.currentBlock}`;
            if (title) title.textContent = `Bloque ${AppState.currentBlock}`;
            if (range) range.textContent = `${myTasks.length} productos asignados`;

            const counted = myTasks.filter(t => AppState.counts.find(c => c.item.id === t.id)).length;
            const pct = myTasks.length > 0 ? Math.round((counted / myTasks.length) * 100) : 0;
            if (progressText) progressText.textContent = `${counted} / ${myTasks.length}`;
            if (progressBar) progressBar.style.width = `${pct}%`;
        }
    } else {
        if (blockBanner) blockBanner.style.display = 'none';
    }

    const myCountedCount = myTasks.filter(t => AppState.counts.find(c => c.item.id === t.id)).length;
    const myPendingCount = myTasks.length - myCountedCount;

    document.getElementById('w-stat-pending').textContent = myPendingCount;
    document.getElementById('w-stat-completed').textContent = myCountedCount;
    
    if (AppState.todayTasks.length === 0) {
        document.getElementById('worker-assigned-summary').textContent = 'No hay tareas cargadas.';
        list.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    if (myTasks.length === 0 && AppState.currentBlock) {
        document.getElementById('worker-assigned-summary').textContent = 'Esperando que el admin publique los bloques...';
        list.innerHTML = `<div class="text-center py-4 text-muted" style="grid-column:1/-1; padding:2rem;">
            <i data-lucide="clock" style="width:32px;height:32px;margin-bottom:8px;"></i>
            <p>Tu bloque aún no tiene productos asignados. El admin publicará los bloques pronto.</p>
        </div>`;
        list.classList.remove('hidden');
        emptyState.classList.add('hidden');
        lucide.createIcons();
        return;
    }

    const searchInput = document.getElementById('worker-search');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filteredTasks = myTasks.filter(task => {
        if (!searchTerm) return true;
        return task.name.toLowerCase().includes(searchTerm) || task.code.toLowerCase().includes(searchTerm);
    });

    if (filteredTasks.length === 0 && searchTerm) {
        document.getElementById('worker-assigned-summary').textContent = 'No se encontraron coincidencias.';
        list.innerHTML = `
            <div class="text-center py-4 text-muted" style="grid-column: 1/-1;">
                <i data-lucide="search-code" style="width: 32px; height: 32px; margin-bottom: 8px;"></i>
                <p>No hay productos que coincidan con la búsqueda.</p>
            </div>
        `;
        list.classList.remove('hidden');
        emptyState.classList.add('hidden');
        lucide.createIcons();
        return;
    }

    document.getElementById('worker-assigned-summary').textContent = myPendingCount === 0
        ? '¡Has terminado todo tu bloque por hoy! 🎉' 
        : `Tienes ${myPendingCount} productos pendientes en tu bloque.`;

    list.classList.remove('hidden');
    emptyState.classList.add('hidden');
    list.innerHTML = '';

    const groups = {};
    filteredTasks.forEach(task => {
        if(!groups[task.provider]) groups[task.provider] = [];
        groups[task.provider].push(task);
    });

    for(const [provider, tasks] of Object.entries(groups)) {
        let countedInGroup = 0;
        tasks.forEach(t => { if(AppState.counts.find(c => c.item.id === t.id)) countedInGroup++; });
        const allDone = countedInGroup === tasks.length;
        const forceOpen = searchTerm.length > 0;

        const groupDiv = document.createElement('div');
        groupDiv.className = `provider-group-card ${provider} ${allDone ? 'all-done' : ''} ${forceOpen ? 'open' : ''}`;
        
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

async function submitProductCount() {
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
    
    // Sincronizar conteos a Supabase en tiempo real
    if (USE_SUPABASE && supabaseClient) {
        if (navigator.onLine) {
            const success = await syncCountsToSupabase();
            if (success) {
                // Limpiar este item de la cola pendiente si estaba ahí
                AppState.pendingSync.counts = AppState.pendingSync.counts.filter(c => c.item.id !== task.id);
                saveData();
                showToast('¡Conteo registrado y sincronizado en la nube!', 'success');
            } else {
                // Falló la sync aunque hay conexión — encolar para reintento
                const alreadyQueued = AppState.pendingSync.counts.find(c => c.item.id === task.id);
                if (!alreadyQueued) {
                    AppState.pendingSync.counts.push(newCount);
                } else {
                    const qi = AppState.pendingSync.counts.findIndex(c => c.item.id === task.id);
                    AppState.pendingSync.counts[qi] = newCount;
                }
                saveData();
                showToast('Guardado localmente. Se sincronizará automáticamente al reconectar.', 'warning');
            }
        } else {
            // Sin conexión — encolar para reintento cuando vuelva online
            const alreadyQueued = AppState.pendingSync.counts.find(c => c.item.id === task.id);
            if (!alreadyQueued) {
                AppState.pendingSync.counts.push(newCount);
            } else {
                const qi = AppState.pendingSync.counts.findIndex(c => c.item.id === task.id);
                AppState.pendingSync.counts[qi] = newCount;
            }
            saveData();
            showToast('Sin conexión. Conteo guardado. Se enviará automáticamente al reconectar.', 'warning');
        }
    } else {
        showToast('¡Conteo guardado localmente!', 'success');
    }
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
