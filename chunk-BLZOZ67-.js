import{c as x$1,s as G$1}from"./chunk-_AdZ4IJm.js";import{L as ct$1,v as Ot}from"./chunk-8Qsnq8Qv.js";import{J as ko,K as jo,N as Zo,O as Xo,Q as po,T as Vo,f as Ko,g as Ne,j as Yo,s as Ho,u as Jo}from"./chunk-BeFDHBQf.js";import"./chunk-C6x9g7Xh.js";import"./chunk-BT46983_.js";import{l as dt}from"./chunk-C8D5vCXO.js";import{Jt as a}from"./main-ZJZ6WBO4.js";import{t}from"./chunk-BezZq9rR.js";import"./chunk-CdEa0oLf.js";import{h as p}from"./chunk-CXF2jnNN.js";var x={showLegend:!0,ticks:5,max:null,min:0,graticule:`circle`};var G={axes:[],curves:[],options:x};var g=structuredClone(G);var U=ko.radar;var X=Ot(()=>dt(x$1(x$1({},U),Ne().radar)),`getConfig`);var P=Ot(()=>g.axes,`getAxes`);var Y=Ot(()=>g.curves,`getCurves`);var Z=Ot(()=>g.options,`getOptions`);var q=Ot(a=>{g.axes=a.map(t=>({name:t.name,label:t.label??t.name}))},`setAxes`);var J=Ot(a=>{g.curves=a.map(t=>({name:t.name,label:t.label??t.name,entries:K(t.entries)}))},`setCurves`);var K=Ot(a=>{if(a[0].axis==null)return a.map(e=>e.value);let t=P();if(t.length===0)throw new Error(`Axes must be populated before curves for reference entries`);return t.map(e=>{let r=a.find(n=>n.axis?.$refText===e.name);if(r===void 0)throw new Error(`Missing entry for axis `+e.label);return r.value})},`computeCurveEntries`);var $={getAxes:P,getCurves:Y,getOptions:Z,setAxes:q,setCurves:J,setOptions:Ot(a=>{let t=a.reduce((e,r)=>(e[r.name]=r,e),{});g.options={showLegend:t.showLegend?.value??x.showLegend,ticks:t.ticks?.value??x.ticks,max:t.max?.value??x.max,min:t.min?.value??x.min,graticule:t.graticule?.value??x.graticule}},`setOptions`),getConfig:X,clear:Ot(()=>{jo(),g=structuredClone(G)},`clear`),setAccTitle:Vo,getAccTitle:Yo,setDiagramTitle:Zo,getDiagramTitle:Jo,getAccDescription:Ko,setAccDescription:Xo};var et=Ot(a=>{t(a,$);let{axes:t$1,curves:e,options:r}=a;$.setAxes(t$1),$.setCurves(e),$.setOptions(r)},`populate`);var at={parse:Ot(a=>G$1(null,null,function*(){let t=yield p(`radar`,a);ct$1.debug(t),et(t)}),`parse`)};var rt=Ot((a$1,t,e,r)=>{let n=r.db,i=n.getAxes(),l=n.getCurves(),s=n.getOptions(),c=n.getConfig(),d=n.getDiagramTitle(),u=nt(a(t),c),m=s.max??Math.max(...l.map(f=>Math.max(...f.entries))),h=s.min,v=Math.min(c.width,c.height)/2;st(u,i,v,s.ticks,s.graticule),ot(u,i,v,c),W(u,i,l,h,m,s.graticule,c),H(u,l,s.showLegend,c),u.append(`text`).attr(`class`,`radarTitle`).text(d).attr(`x`,0).attr(`y`,-c.height/2-c.marginTop)},`draw`);var nt=Ot((a,t)=>{let e=t.width+t.marginLeft+t.marginRight,r=t.height+t.marginTop+t.marginBottom,n={x:t.marginLeft+t.width/2,y:t.marginTop+t.height/2};return Ho(a,r,e,t.useMaxWidth??!0),a.attr(`viewBox`,`0 0 ${e} ${r}`),a.append(`g`).attr(`transform`,`translate(${n.x}, ${n.y})`)},`drawFrame`);var st=Ot((a,t,e,r,n)=>{if(n===`circle`)for(let i=0;i<r;i++){let l=e*(i+1)/r;a.append(`circle`).attr(`r`,l).attr(`class`,`radarGraticule`)}else if(n===`polygon`){let i=t.length;for(let l=0;l<r;l++){let s=e*(l+1)/r,c=t.map((d,p)=>{let u=2*p*Math.PI/i-Math.PI/2;return`${s*Math.cos(u)},${s*Math.sin(u)}`}).join(` `);a.append(`polygon`).attr(`points`,c).attr(`class`,`radarGraticule`)}}},`drawGraticule`);var ot=Ot((a,t,e,r)=>{let n=t.length;for(let i=0;i<n;i++){let l=t[i].label,s=2*i*Math.PI/n-Math.PI/2;a.append(`line`).attr(`x1`,0).attr(`y1`,0).attr(`x2`,e*r.axisScaleFactor*Math.cos(s)).attr(`y2`,e*r.axisScaleFactor*Math.sin(s)).attr(`class`,`radarAxisLine`),a.append(`text`).text(l).attr(`x`,e*r.axisLabelFactor*Math.cos(s)).attr(`y`,e*r.axisLabelFactor*Math.sin(s)).attr(`class`,`radarAxisLabel`)}},`drawAxes`);function W(a,t,e,r,n,i,l){let s=t.length,c=Math.min(l.width,l.height)/2;e.forEach((d,p)=>{if(d.entries.length!==s)return;let u=d.entries.map((m,h)=>{let v=2*Math.PI*h/s-Math.PI/2,f=B(m,r,n,c);return{x:f*Math.cos(v),y:f*Math.sin(v)}});i===`circle`?a.append(`path`).attr(`d`,V(u,l.curveTension)).attr(`class`,`radarCurve-${p}`):i===`polygon`&&a.append(`polygon`).attr(`points`,u.map(m=>`${m.x},${m.y}`).join(` `)).attr(`class`,`radarCurve-${p}`)})}Ot(W,`drawCurves`);function B(a,t,e,r){return r*(Math.min(Math.max(a,t),e)-t)/(e-t)}Ot(B,`relativeRadius`);function V(a,t){let e=a.length,r=`M${a[0].x},${a[0].y}`;for(let n=0;n<e;n++){let i=a[(n-1+e)%e],l=a[n],s=a[(n+1)%e],c=a[(n+2)%e],d={x:l.x+(s.x-i.x)*t,y:l.y+(s.y-i.y)*t},p={x:s.x-(c.x-l.x)*t,y:s.y-(c.y-l.y)*t};r+=` C${d.x},${d.y} ${p.x},${p.y} ${s.x},${s.y}`}return`${r} Z`}Ot(V,`closedRoundCurve`);function H(a,t,e,r){if(!e)return;let n=(r.width/2+r.marginRight)*3/4,i=-(r.height/2+r.marginTop)*3/4,l=20;t.forEach((s,c)=>{let d=a.append(`g`).attr(`transform`,`translate(${n}, ${i+c*l})`);d.append(`rect`).attr(`width`,12).attr(`height`,12).attr(`class`,`radarLegendBox-${c}`),d.append(`text`).attr(`x`,16).attr(`y`,0).attr(`class`,`radarLegendText`).text(s.label)})}Ot(H,`drawLegend`);var it={draw:rt};var lt=Ot((a,t)=>{let e=``;for(let r=0;r<a.THEME_COLOR_LIMIT;r++){let n=a[`cScale${r}`];e+=`
		.radarCurve-${r} {
			color: ${n};
			fill: ${n};
			fill-opacity: ${t.curveOpacity};
			stroke: ${n};
			stroke-width: ${t.curveStrokeWidth};
		}
		.radarLegendBox-${r} {
			fill: ${n};
			fill-opacity: ${t.curveOpacity};
			stroke: ${n};
		}
		`}return e},`genIndexStyles`);var ct=Ot(a=>{let t=po(),e=Ne(),r=dt(t,e.themeVariables);return{themeVariables:r,radarOptions:dt(r.radar,a)}},`buildRadarStyleOptions`);var vt={parser:at,db:$,renderer:it,styles:Ot(({radar:a}={})=>{let{themeVariables:t,radarOptions:e}=ct(a);return`
	.radarTitle {
		font-size: ${t.fontSize};
		color: ${t.titleColor};
		dominant-baseline: hanging;
		text-anchor: middle;
	}
	.radarAxisLine {
		stroke: ${e.axisColor};
		stroke-width: ${e.axisStrokeWidth};
	}
	.radarAxisLabel {
		dominant-baseline: middle;
		text-anchor: middle;
		font-size: ${e.axisLabelFontSize}px;
		color: ${e.axisColor};
	}
	.radarGraticule {
		fill: ${e.graticuleColor};
		fill-opacity: ${e.graticuleOpacity};
		stroke: ${e.graticuleColor};
		stroke-width: ${e.graticuleStrokeWidth};
	}
	.radarLegendText {
		text-anchor: start;
		font-size: ${e.legendFontSize}px;
		dominant-baseline: hanging;
	}
	${lt(t,e)}
	`},`styles`)};export{vt as diagram};