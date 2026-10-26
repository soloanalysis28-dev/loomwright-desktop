(function(){
  const root=document.documentElement;
  const read=value=>{try{return JSON.parse(localStorage.getItem(value)||'null')}catch(_){return null}};
  let settings=read('loomwright_app_settings_v1');
  if(!settings||typeof settings!=='object'){
    const legacy=read('loomwright_state'),store=read('loomwright_projects_v1'),project=store?.projects?.find(item=>item.id===store.activeProjectId)||store?.projects?.[0];
    settings=project?.data?.settings||legacy?.settings||{};
  }
  let palette=settings.palette,theme=settings.theme,effect=settings.bgEffect||'none';
  if(!['sage','parchment','slate','forest','ink'].includes(palette))palette='sage';
  if(!['auto','light','dark'].includes(theme))theme='light';
  if(palette==='parchment'&&theme==='auto'){palette='sage';theme='light'}
  else if(theme==='auto')theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  if(!['none','rain','clouds','snow','dragon'].includes(effect))effect='none';
  const navPosition = settings.navPosition === 'side' ? 'side' : 'top';
  root.dataset.palette=palette;root.dataset.theme=theme;root.dataset.bgEffect=effect;root.dataset.navPosition=navPosition;
  const applyNavPos = () => { if (document.body) document.body.classList.toggle('nav-side-mounted', navPosition === 'side'); };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', applyNavPos); } else { applyNavPos(); }
  const themeColor=document.querySelector('meta[name="theme-color"]'),background=getComputedStyle(root).getPropertyValue('--bg').trim();
  if(themeColor&&background)themeColor.content=background;

  const writing = settings?.writing || {};
  const BUNDLED_FONTS = ['Bitter', 'Crimson Text', 'EB Garamond', 'Libre Baskerville', 'Lora', 'Merriweather', 'PT Serif', 'Playfair Display'];
  const font = BUNDLED_FONTS.includes(writing.fontFamily) ? writing.fontFamily : 'Lora';
  const size = Math.max(14, Math.min(28, Number(writing.fontSize) || 18));
  const line = Math.max(1.3, Math.min(2.2, Number(writing.lineHeight) || 1.7));
  const widthMap = { narrow: '640px', medium: '816px', wide: '1020px' };
  const measure = widthMap[writing.columnWidth] || '816px';
  const pageStyle = writing.pageStyle === 'flat' ? 'flat' : 'paper';
  const indent = Boolean(writing.firstLineIndent);
  const toolbarMode = writing.toolbarMode === 'pinned' ? 'pinned' : 'auto';

  root.style.setProperty('--editor-font', `'${font}', Georgia, serif`);
  root.style.setProperty('--editor-size', `${size}px`);
  root.style.setProperty('--editor-line', String(line));
  root.style.setProperty('--editor-measure', measure);

  function applyEarlyEditorWrap(){
    const wrap = document.getElementById('editor-wrap');
    if (wrap) {
      wrap.style.setProperty('--editor-font', `'${font}', Georgia, serif`);
      wrap.style.setProperty('--editor-size', `${size}px`);
      wrap.style.setProperty('--editor-line', String(line));
      wrap.style.setProperty('--editor-measure', measure);
      wrap.classList.toggle('page-style-paper', pageStyle === 'paper');
      wrap.classList.toggle('page-style-flat', pageStyle === 'flat');
      wrap.classList.toggle('has-first-line-indent', indent);
      wrap.classList.toggle('toolbar-pinned', toolbarMode === 'pinned');
      wrap.classList.toggle('toolbar-auto', toolbarMode === 'auto');
    }
    if (writing.focusHides) {
      document.body?.classList.toggle('focus-hide-nav', writing.focusHides.nav !== false);
      document.body?.classList.toggle('focus-hide-toolbar', writing.focusHides.toolbar !== false);
      document.body?.classList.toggle('focus-hide-footer', Boolean(writing.focusHides.footer));
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyEarlyEditorWrap);
  } else {
    applyEarlyEditorWrap();
  }

  function ensureAtmosphere(){
    const sel=document.getElementById('bg-effect-select');
    if(sel){
      const rainOpt=sel.querySelector('option[value="rain"]');
      if(rainOpt)rainOpt.textContent='Water ripples';
      if(!sel.querySelector('option[value="snow"]')){
        const opt=document.createElement('option');
        opt.value='snow';
        opt.textContent='Snow';
        sel.appendChild(opt);
      }
      if(effect)sel.value=effect;
    }
    const bg=document.getElementById('bg-effect');
    if(bg){
      const rain=bg.querySelector('.bg-rain');
      if(rain&&!rain.querySelector('.ripple')){
        for(let i=1;i<=12;i++){
          const rip=document.createElement('div');
          rip.className=`ripple rip${i}`;
          rain.appendChild(rip);
        }
      }
      if(!bg.querySelector('.bg-snow')){
        const layer=document.createElement('div');
        layer.className='bg-layer bg-snow';
        for(let i=1;i<=20;i++){
          const span=document.createElement('span');
          span.className=`flake f${i}`;
          layer.appendChild(span);
        }
        bg.appendChild(layer);
      }
      const dragons=bg.querySelector('.bg-dragons'),firstDragon=dragons?.querySelector('.dragon-flight-one');
      if(dragons&&firstDragon&&!dragons.querySelector('.dragon-flight-two')){
        const second=firstDragon.cloneNode(true);second.classList.remove('dragon-flight-one');second.classList.add('dragon-flight-two');dragons.appendChild(second);
        const third=firstDragon.cloneNode(true);third.classList.remove('dragon-flight-one');third.classList.add('dragon-flight-three');dragons.appendChild(third);
      }
    }
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',ensureAtmosphere);
  }else{
    ensureAtmosphere();
  }
})();
