(() => {
  'use strict';

  const EARLY_STAGES = ['NEW', 'RESEARCH'];
  const ALL_STAGES = ['NEW', 'RESEARCH', 'CONTACTED', 'REPLIED', 'DISCOVERY', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'VERBAL_CONFIRMATION', 'WON', 'LOST', 'ON_HOLD'];
  const mountedPipelines = new WeakSet();
  let scheduled = false;

  const titleCase = (value) => String(value || '')
    .toLowerCase()
    .split('_')
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
    .join(' ');

  const money = (value, currency = 'USD', compact = false) => {
    const safeCurrency = /^[A-Z]{3,5}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'USD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: safeCurrency,
        maximumFractionDigits: compact ? 1 : 0,
        notation: compact ? 'compact' : 'standard',
      }).format(Number(value || 0));
    } catch {
      return `${safeCurrency} ${Number(value || 0).toLocaleString('en-US')}`;
    }
  };

  const isOverdue = (value) => {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
  };

  function isOpportunityView() {
    const heading = document.querySelector('#view-root .page-head h1')?.textContent?.trim();
    return heading === 'Opportunity Pipeline';
  }

  function createDealCard(item) {
    const article = document.createElement('article');
    article.className = 'deal-card';
    article.dataset.openLead = String(item.project_id || '');
    article.dataset.akariOpportunityId = String(item.id || '');

    const project = document.createElement('strong');
    project.textContent = item.project_name || 'Project';

    const dealTitle = document.createElement('div');
    dealTitle.className = 'deal-title';
    dealTitle.textContent = item.name || 'Opportunity';

    const values = document.createElement('div');
    values.className = 'deal-values';
    const amount = document.createElement('span');
    amount.className = 'finance-value';
    amount.textContent = money(item.estimated_value_base_currency || item.estimated_value || 0, item.currency || 'USD');
    const probability = document.createElement('span');
    probability.textContent = `${Number(item.probability_percentage || 0)}%`;
    values.append(amount, probability);

    const foot = document.createElement('div');
    foot.className = 'deal-foot';
    const owner = document.createElement('span');
    owner.textContent = item.owner_name || 'Unassigned';
    const nextAction = document.createElement('span');
    nextAction.textContent = item.next_action || 'No next action';
    nextAction.style.color = (!item.next_action || isOverdue(item.next_follow_up_at)) ? 'var(--red)' : 'var(--muted-2)';
    foot.append(owner, nextAction);

    const select = document.createElement('select');
    select.className = 'stage-select';
    select.dataset.action = 'change-stage';
    select.dataset.id = String(item.id || '');
    select.setAttribute('aria-label', `Stage for ${item.name || 'opportunity'}`);
    select.addEventListener('click', (event) => event.stopPropagation());
    for (const stage of ALL_STAGES) {
      const option = document.createElement('option');
      option.value = stage;
      option.textContent = titleCase(stage);
      option.selected = item.stage === stage;
      select.appendChild(option);
    }

    article.append(project, dealTitle, values, foot, select);
    return article;
  }

  function createStageColumn(stage, items) {
    const section = document.createElement('section');
    section.className = 'stage';
    section.dataset.akariEarlyStage = stage;
    section.dataset.akariOpportunityVisibility = 'r23';

    const value = items.reduce((sum, item) => sum + Number(item.estimated_value_base_currency || item.estimated_value || 0), 0);
    const head = document.createElement('div');
    head.className = 'stage-head';
    const copy = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = titleCase(stage);
    const summary = document.createElement('span');
    summary.textContent = `${items.length} opportunities · ${money(value, 'USD', true)}`;
    copy.append(heading, summary);
    const count = document.createElement('span');
    count.className = 'pill';
    count.textContent = String(items.length);
    head.append(copy, count);
    section.appendChild(head);

    if (items.length) {
      items.forEach((item) => section.appendChild(createDealCard(item)));
    } else {
      const empty = document.createElement('div');
      empty.className = 'deal-card';
      const label = document.createElement('div');
      label.className = 'deal-title';
      label.textContent = 'No opportunities in this stage';
      empty.appendChild(label);
      section.appendChild(empty);
    }
    return section;
  }

  async function loadOpportunities() {
    const response = await fetch('/api/opportunities', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Opportunity request failed (${response.status})`);
    return Array.isArray(payload.items) ? payload.items : [];
  }

  async function mount() {
    scheduled = false;
    if (!isOpportunityView()) return;
    const pipeline = document.querySelector('#view-root .pipeline');
    if (!pipeline || mountedPipelines.has(pipeline)) return;
    mountedPipelines.add(pipeline);
    pipeline.dataset.akariOpportunityVisibility = 'loading';

    try {
      const opportunities = await loadOpportunities();
      if (!pipeline.isConnected || !isOpportunityView()) return;
      const activeCommercial = opportunities.filter((item) =>
        !['WON', 'LOST'].includes(String(item.stage || '').toUpperCase())
        && !String(item.service_type || '').toUpperCase().includes('FUNDRAISING')
      );
      const fragment = document.createDocumentFragment();
      for (const stage of EARLY_STAGES) {
        fragment.appendChild(createStageColumn(stage, activeCommercial.filter((item) => item.stage === stage)));
      }
      pipeline.prepend(fragment);
      pipeline.dataset.akariOpportunityVisibility = 'r23';
    } catch (error) {
      mountedPipelines.delete(pipeline);
      pipeline.dataset.akariOpportunityVisibility = 'error';
      console.warn('AKARI opportunity visibility check failed', error);
    }
  }

  function scheduleMount() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(mount);
  }

  new MutationObserver(scheduleMount).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scheduleMount);
  document.addEventListener('akari:route-rendered', scheduleMount);
  window.addEventListener('popstate', scheduleMount);
  window.addEventListener('hashchange', scheduleMount);
  scheduleMount();
})();
