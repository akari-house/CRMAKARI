const viewNames = { home: 'Home', day: 'My Day', projects: 'Projects', pipeline: 'Opportunities' };
  function switchView(name, navEl) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + name); if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    if (navEl && navEl.classList.contains('nav-item')) navEl.classList.add('active');
    document.getElementById('crumb').textContent = viewNames[name] || name;
    window.scrollTo({ top: 0, behavior: 'smooth' }); toggleSidebar(false);
  }
  function toggleSidebar(force) {
    const s = document.getElementById('sidebar'), b = document.getElementById('sidebarBackdrop');
    const shouldOpen = typeof force === 'boolean' ? force : !s.classList.contains('open');
    s.classList.toggle('open', shouldOpen); b.classList.toggle('open', shouldOpen);
  }
  function toggleCreate() { document.getElementById('quickCreate').classList.toggle('open'); }
  function createAction(type) { document.getElementById('quickCreate').classList.remove('open'); showToast(type + ' form opened'); }
  function openProject(name) {
    const initials = name.split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase();
    document.getElementById('drawerTitle').textContent = name; document.getElementById('drawerLogo').textContent = initials;
    document.getElementById('drawerOverlay').classList.add('open'); document.getElementById('drawer').classList.add('open');
  }
  function closeDrawer() { document.getElementById('drawerOverlay').classList.remove('open'); document.getElementById('drawer').classList.remove('open'); }
  function completeTask(btn) {
    btn.classList.toggle('checked');
    showToast(btn.classList.contains('checked') ? 'Task completed' : 'Task restored');
  }
  function toggleScreenShare() {
    document.body.classList.toggle('screen-share-hidden');
    const active = document.body.classList.contains('screen-share-hidden');
    document.getElementById('shareBtn').style.color = active ? 'var(--pink)' : '';
    showToast(active ? 'Screen-share mode enabled â€” financial values hidden' : 'Screen-share mode disabled');
  }
  function openCommand() { document.getElementById('command').classList.add('open'); setTimeout(() => document.getElementById('commandInput').focus(), 20); }
  function closeCommand() { document.getElementById('command').classList.remove('open'); }
  function showToast(message) {
    const toast = document.getElementById('toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }
  function filterProjects() {
    const q = document.getElementById('projectSearch').value.toLowerCase().trim();
    document.querySelectorAll('#projectsTable tbody tr').forEach(row => { row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none'; });
  }
  function setMobileActive(btn) { document.querySelectorAll('.mobile-bottom button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
  document.querySelectorAll('.drawer-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); showToast(tab.textContent + ' tab selected');
  }));
  document.querySelectorAll('.view-tab').forEach(tab => tab.addEventListener('click', () => {
    const parent = tab.parentElement; parent.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active');
  }));
  document.querySelectorAll('.segmented').forEach(seg => seg.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    seg.querySelectorAll('button').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  })));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommand(); }
    if (e.key === 'Escape') { closeCommand(); closeDrawer(); document.getElementById('quickCreate').classList.remove('open'); }
  });
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('quickCreate');
    if (menu.classList.contains('open') && !menu.contains(e.target) && !e.target.closest('.soft-btn')) menu.classList.remove('open');
  });


// Progressive Web App registration. The CRM still works when service workers are unavailable.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

