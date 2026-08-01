(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  };
  const toast = (message, type = 'success') => {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  };

  function modal(html) {
    const root = $('#modal-root');
    if (!root) return;
    root.innerHTML = `<div class="modal-backdrop" data-lifecycle-close><div class="modal wide lifecycle-modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">${html}</div></div>`;
  }

  function closeModal() {
    const root = $('#modal-root');
    if (root) root.innerHTML = '';
  }

  function field(name, label, options = {}) {
    const required = options.required ? 'required' : '';
    const full = options.full ? ' field-full' : '';
    if (options.type === 'select') {
      return `<label class="field${full}"><span>${esc(label)}</span><select name="${esc(name)}" ${required}>${(options.options || []).map((item) => {
        const value = typeof item === 'string' ? item : item.value;
        const text = typeof item === 'string' ? item.replaceAll('_', ' ') : item.label;
        return `<option value="${esc(value)}" ${String(options.value || '') === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
      }).join('')}</select></label>`;
    }
    if (options.type === 'textarea') {
      return `<label class="field${full}"><span>${esc(label)}</span><textarea name="${esc(name)}" ${required} placeholder="${esc(options.placeholder || '')}">${esc(options.value || '')}</textarea></label>`;
    }
    return `<label class="field${full}"><span>${esc(label)}</span><input name="${esc(name)}" type="${esc(options.type || 'text')}" value="${esc(options.value || '')}" ${required} ${options.min !== undefined ? `min="${options.min}"` : ''} ${options.step ? `step="${options.step}"` : ''} placeholder="${esc(options.placeholder || '')}" /></label>`;
  }

  function setSectionVisibility(form) {
    const type = form.elements.conversionType.value;
    const client = $('#conversion-client-section', form);
    const partner = $('#conversion-partner-section', form);
    if (client) client.hidden = type === 'PARTNER';
    if (partner) partner.hidden = type === 'CLIENT';
  }

  function referralPreview(form) {
    const value = Number(form.elements.contractValue?.value || 0);
    const costs = Number(form.elements.directCost?.value || 0) + Number(form.elements.creatorCost?.value || 0) + Number(form.elements.otherCost?.value || 0);
    const percentage = Number(form.elements.referralPercentage?.value || 0);
    const basis = form.elements.referralBasis?.value || 'NET_REVENUE';
    const fixed = Number(form.elements.fixedReferralAmount?.value || 0);
    const basisValue = basis === 'GROSS_REVENUE' ? value : Math.max(0, value - costs);
    const amount = basis === 'FIXED' ? fixed : basisValue * percentage / 100;
    const node = $('#referral-preview', form);
    if (node) node.textContent = `Estimated referral due: ${new Intl.NumberFormat('en-US', { style:'currency', currency: form.elements.currency?.value || 'USD' }).format(amount || 0)}`;
  }

  async function openConversion(projectId, projectName) {
    let partners = [];
    try {
      const payload = await api('/api/partners');
      partners = payload.items || [];
    } catch {
      partners = [];
    }
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    modal(`
      <form id="lead-conversion-form">
        <div class="modal-head"><div><div class="eyebrow">LEAD LIFECYCLE</div><h2>Convert ${esc(projectName || 'lead')}</h2><p>Preserve the relationship history and create the next operational records.</p></div><button type="button" class="close" data-lifecycle-close>×</button></div>
        <div class="modal-body">
          <div class="live-banner">Referral attribution is recorded before conversion so the introducer, percentage and payment obligation are never lost.</div>
          <div class="form-grid lifecycle-grid">
            ${field('conversionType','Convert to',{type:'select',value:'CLIENT',options:[{value:'CLIENT',label:'Client'},{value:'PARTNER',label:'Partner'},{value:'BOTH',label:'Both Partner and Client'}],required:true})}
            ${field('nextFollowUpAt','Next follow-up',{type:'datetime-local'})}
          </div>

          <section class="lifecycle-section">
            <div class="panel-title"><strong>Referral and introducer</strong><span>Who brought this relationship to AKARI?</span></div>
            <div class="form-grid lifecycle-grid">
              ${field('introducerPartnerId','Existing introducer',{type:'select',options:[{value:'',label:'No existing partner selected'},...partners.map((partner)=>({value:partner.id,label:`${partner.name} · ${Number(partner.default_referral_percentage || 0)}%`}))]})}
              ${field('introducerName','Or create introducer',{placeholder:'Referral person or company'})}
              ${field('introducerContactName','Contact person')}
              ${field('introducerEmail','Introducer email',{type:'email'})}
              ${field('introducerTelegram','Introducer Telegram')}
              ${field('referralPercentage','Referral %',{type:'number',value:'5',min:0,step:'0.01'})}
              ${field('referralBasis','Referral basis',{type:'select',value:'NET_REVENUE',options:[{value:'NET_REVENUE',label:'Net revenue after direct costs'},{value:'GROSS_REVENUE',label:'Gross revenue'},{value:'FIXED',label:'Fixed amount'}]})}
              ${field('fixedReferralAmount','Fixed referral amount',{type:'number',value:'0',min:0,step:'0.01'})}
              ${field('referralAgreementStatus','Agreement status',{type:'select',value:'DRAFT',options:['DRAFT','ACTIVE','EXPIRED','TERMINATED']})}
              ${field('referralDueDate','Referral due date',{type:'date',value:due})}
              ${field('referralNotes','Referral terms / evidence',{type:'textarea',full:true,placeholder:'Agreement link, Telegram confirmation, payment conditions…'})}
            </div>
            <div class="referral-preview" id="referral-preview">Estimated referral due: $0.00</div>
          </section>

          <section class="lifecycle-section" id="conversion-partner-section" hidden>
            <div class="panel-title"><strong>Partner setup</strong><span>Create or update the partner record from this lead.</span></div>
            <div class="form-grid lifecycle-grid">
              ${field('partnerType','Partner type',{type:'select',value:'STRATEGIC',options:['STRATEGIC','REFERRAL','AGENCY','CREATOR_NETWORK','FUNDRAISING_PARTNER','INVESTOR_INTRODUCER','OTHER']})}
              ${field('partnerAgreementStatus','Partner agreement',{type:'select',value:'DRAFT',options:['DRAFT','ACTIVE','EXPIRED','TERMINATED']})}
              ${field('partnerNotes','Partner scope',{type:'textarea',full:true})}
            </div>
          </section>

          <section class="lifecycle-section" id="conversion-client-section">
            <div class="panel-title"><strong>Client service engagement</strong><span>Define what AKARI is delivering, for how long and under what commercial model.</span></div>
            <div class="form-grid lifecycle-grid">
              ${field('serviceName','Service engagement name',{required:true,placeholder:'Example: 3-month GTM and creator campaign'})}
              ${field('serviceType','Service type',{type:'select',value:'GTM_STRATEGY',options:['GTM_STRATEGY','MARKETING_RETAINER','CREATOR_CAMPAIGN','COMMUNITY_MANAGEMENT','BUSINESS_DEVELOPMENT','FUNDRAISING_RETAINER','FUNDRAISING_SUCCESS_FEE','ADVISORY','LAUNCHPAD_SUPPORT','EVENT_X_SPACES','CUSTOM']})}
              ${field('billingModel','Billing model',{type:'select',value:'MONTHLY_RETAINER',options:['ONE_TIME','MONTHLY_RETAINER','MILESTONE','SUCCESS_FEE','HOURLY','CUSTOM']})}
              ${field('currency','Currency',{type:'select',value:'USD',options:['USD','EUR','USDT','GBP']})}
              ${field('startDate','Start date',{type:'date',value:today})}
              ${field('endDate','End date',{type:'date'})}
              ${field('durationMonths','Duration in months',{type:'number',value:'3',min:0,step:'0.5'})}
              ${field('renewalDate','Renewal review date',{type:'date'})}
              ${field('contractValue','Contract value',{type:'number',value:'0',min:0,step:'0.01'})}
              ${field('directCost','Direct campaign cost',{type:'number',value:'0',min:0,step:'0.01'})}
              ${field('creatorCost','Creator / KOL cost',{type:'number',value:'0',min:0,step:'0.01'})}
              ${field('otherCost','Other cost',{type:'number',value:'0',min:0,step:'0.01'})}
              ${field('deliverables','Deliverables',{type:'textarea',full:true,placeholder:'Campaigns, content, spaces, BD introductions, reporting…'})}
              ${field('nextAction','Next action',{full:true,placeholder:'Onboarding call, invoice, campaign brief…'})}
            </div>
          </section>

          ${field('conversionNotes','Internal conversion notes',{type:'textarea',full:true})}
        </div>
        <div class="modal-foot"><button type="button" class="btn" data-lifecycle-close>Cancel</button><button class="btn primary" type="submit">Convert relationship</button></div>
      </form>
    `);

    const form = $('#lead-conversion-form');
    setSectionVisibility(form);
    referralPreview(form);
    form.addEventListener('change', () => { setSectionVisibility(form); referralPreview(form); });
    form.addEventListener('input', () => referralPreview(form));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = 'Converting…';
      const data = Object.fromEntries(new FormData(form));
      const payload = {
        ...data,
        referralPercentage: Number(data.referralPercentage || 0),
        fixedReferralAmount: Number(data.fixedReferralAmount || 0),
        contractValue: Number(data.contractValue || 0),
        directCost: Number(data.directCost || 0),
        creatorCost: Number(data.creatorCost || 0),
        otherCost: Number(data.otherCost || 0),
        durationMonths: Number(data.durationMonths || 0),
      };
      try {
        const result = await api(`/api/projects/${encodeURIComponent(projectId)}/convert`, { method:'POST', body:JSON.stringify(payload) });
        closeModal();
        toast(result.introducer ? `Converted with referral attributed to ${result.introducer.name}` : 'Relationship converted successfully');
        setTimeout(() => location.reload(), 800);
      } catch (error) {
        submit.disabled = false;
        submit.textContent = 'Convert relationship';
        toast(error.message || 'Conversion failed', 'error');
      }
    });
  }

  function enhanceLeadModal() {
    const root = $('#modal-root');
    const modalNode = root?.querySelector('.modal');
    if (!modalNode || modalNode.dataset.lifecycleEnhanced === '1') return;
    const projectButton = modalNode.querySelector('[data-project]');
    const projectId = projectButton?.dataset.project;
    if (!projectId) return;
    const heading = modalNode.querySelector('h2');
    const footer = modalNode.querySelector('.form-actions, .modal-foot');
    if (!footer) return;
    modalNode.dataset.lifecycleEnhanced = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn yellow';
    button.textContent = 'Convert lead';
    button.dataset.lifecycleConvert = projectId;
    button.dataset.projectName = heading?.textContent?.trim() || 'Lead';
    footer.prepend(button);
  }

  function enhanceLeadsPage() {
    const root = $('#view-root');
    if (!root || root.dataset.lifecyclePageEnhanced === '1') return;
    const heading = root.querySelector('.page-head h1');
    if (!heading || !/AKARI Leads/i.test(heading.textContent)) return;
    root.dataset.lifecyclePageEnhanced = '1';
    const tools = root.querySelector('.table-tools');
    if (tools) {
      const note = document.createElement('div');
      note.className = 'lifecycle-help';
      note.innerHTML = '<strong>Lifecycle workflow:</strong> open any lead to record activities, follow-ups and convert it into a Partner, Client or both. Referral attribution is captured during conversion.';
      tools.after(note);
    }
  }

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-lifecycle-close]');
    if (close) { event.preventDefault(); closeModal(); return; }
    const convert = event.target.closest('[data-lifecycle-convert]');
    if (convert) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openConversion(convert.dataset.lifecycleConvert, convert.dataset.projectName);
    }
  }, true);

  const observer = new MutationObserver(() => {
    enhanceLeadModal();
    enhanceLeadsPage();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
})();
