export const BRAND_DEFAULTS={organization_name:null,subtitle:null,mode:'light',accent_color:'#2a3990',background_color:'#f4f5f9',sidebar_color:'#ffffff',logo_id:null,background_id:null,background_opacity:0.12};
export const BRAND_PRESETS={light:{mode:'light',accent_color:'#2a3990',background_color:'#f4f5f9',sidebar_color:'#ffffff'},dark:{mode:'dark',accent_color:'#a7b8ff',background_color:'#141b2d',sidebar_color:'#182033'},warm:{mode:'light',accent_color:'#80391f',background_color:'#faf6ee',sidebar_color:'#fffcf6'}};
export const brandHex=value=>/^#[0-9a-f]{6}$/i.test(value||'');
const brandRgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const brandLuma=c=>brandRgb(c).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
export function brandContrast(a,b){const x=brandLuma(a),y=brandLuma(b);return(Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
const brandMix=(a,b,n)=>'#'+brandRgb(a).map((v,i)=>Math.round(v*(1-n)+brandRgb(b)[i]*n).toString(16).padStart(2,'0')).join('');
const brandText=c=>brandContrast(c,'#171a2e')>=brandContrast(c,'#ffffff')?'#171a2e':'#ffffff';
export function brandPalette(input){
 const c={...BRAND_DEFAULTS,...input},dark=c.mode==='dark',ink=dark?'#edf1ff':'#171a2e',surface=dark?'#20283b':'#ffffff',sideInk=brandText(c.sidebar_color);
 let muted=dark?'#b5bfd3':'#60667b';const backgrounds=brandPageColors(c);
 for(let n=0;n<12&&backgrounds.some(bg=>brandContrast(bg,muted)<4.5);n++)muted=brandMix(muted,ink,0.15);
 let sideMuted=brandMix(c.sidebar_color,sideInk,0.85);if(brandContrast(c.sidebar_color,sideMuted)<4.5)sideMuted=sideInk;
 return {'--bg':c.background_color,'--surface':surface,'--ink':ink,'--muted':muted,'--line':dark?'#39425b':'#dde0eb','--accent':c.accent_color,'--accent-ink':brandText(c.accent_color),'--soft':dark?'#283352':'#e6e9f8','--sidebar-bg':c.sidebar_color,'--sidebar-ink':sideInk,'--sidebar-muted':sideMuted,'--sidebar-control':brandMix(c.sidebar_color,sideInk==='#ffffff'?'#000000':'#ffffff',0.06),'--sidebar-line':brandMix(c.sidebar_color,sideInk,0.24),'--page-overlay':'rgba('+brandRgb(c.background_color).join(',')+','+(1-c.background_opacity)+')'};
}
export const brandPageColors=c=>c.background_id?[brandMix(c.background_color,'#000000',c.background_opacity),brandMix(c.background_color,'#ffffff',c.background_opacity)]:[c.background_color];
export function brandColorErrors(c){
 if(!['accent_color','background_color','sidebar_color'].every(k=>brandHex(c[k])))return ['colors'];
 const p=brandPalette(c),errors=[];
 if(brandPageColors(c).some(bg=>brandContrast(bg,p['--ink'])<4.5||brandContrast(bg,p['--muted'])<4.5))errors.push('background_color');
 if(brandPageColors(c).some(bg=>brandContrast(c.accent_color,bg)<4.5)||brandContrast(c.accent_color,p['--surface'])<4.5)errors.push('accent_color');
 return errors;
}
