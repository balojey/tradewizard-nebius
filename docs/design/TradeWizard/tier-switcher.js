// Tier switcher - shared across all product pages
(function(){
  const tiers = ['free','starter','pro','elite'];
  const tierData = {
    free:    { label:'Free', credits:'3/5', badge:'Free' },
    starter: { label:'Starter', credits:'38/50', badge:'Starter' },
    pro:     { label:'Pro', credits:'47/200', badge:'Pro' },
    elite:   { label:'Elite', credits:'∞', badge:'Elite' }
  };

  // Create switcher UI
  const sw = document.createElement('div');
  sw.className = 'tier-switcher';
  sw.innerHTML = `
    <div class="tier-sw-label">Viewing as:</div>
    <div class="tier-sw-btns">
      ${tiers.map(t=>`<button data-t="${t}" class="${t==='pro'?'active':''}">${tierData[t].label}</button>`).join('')}
    </div>
  `;
  document.body.appendChild(sw);

  // Set initial tier
  const saved = localStorage.getItem('tw-tier') || 'pro';
  setTier(saved);

  // Button handlers
  sw.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click',()=>{ setTier(btn.dataset.t); });
  });

  function setTier(tier){
    document.documentElement.setAttribute('data-tier', tier);
    localStorage.setItem('tw-tier', tier);
    sw.querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.t===tier));
    // Update credit badge
    const cb = document.querySelector('.credit-badge');
    if(cb){
      const d = tierData[tier];
      cb.querySelector('.credit-text').textContent = tier==='elite' ? '∞ credits' : d.credits+' credits';
    }
    // Update gated-row text for paid tiers
    document.querySelectorAll('.gated-row').forEach(r=>{
      const lock = r.querySelector('.lock');
      if(lock){
        if(tier==='free') r.childNodes[1].textContent = ' Recurring analysis · ';
        else if(tier==='elite') r.childNodes[1].textContent = ' Recurring analysis · included ';
        else r.childNodes[1].textContent = ' Recurring analysis · 1 credit per run ';
      }
    });
    // Update sidebar credit usage if present
    const cu = document.querySelector('.credit-usage');
    if(cu){
      const vals = {free:{bal:'3 / 5',used:'2',pct:'40%'},starter:{bal:'38 / 50',used:'12',pct:'24%'},pro:{bal:'47 / 200',used:'153',pct:'76.5%'},elite:{bal:'∞',used:'47',pct:'100%'}};
      const v = vals[tier];
      const rows = cu.querySelectorAll('.credit-row .val');
      if(rows[0]) rows[0].textContent = v.bal;
      if(rows[1]) rows[1].textContent = v.used;
      const fill = cu.querySelector('.credit-meter .fill');
      if(fill) fill.style.width = v.pct;
    }
  }
})();
