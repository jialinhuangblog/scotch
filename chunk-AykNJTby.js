import{s as G}from"./chunk-_AdZ4IJm.js";import{L as ct,g as Oc,i as Ec,tt as ze,v as Ot}from"./chunk-8Qsnq8Qv.js";import{J as ko,K as jo,N as Zo,O as Xo,T as Vo,W as ir,f as Ko,j as Yo,s as Ho,u as Jo}from"./chunk-BeFDHBQf.js";import"./chunk-C6x9g7Xh.js";import"./chunk-BT46983_.js";import{i as P,l as dt}from"./chunk-C8D5vCXO.js";import{Jt as a}from"./main-ZJZ6WBO4.js";import{t}from"./chunk-BezZq9rR.js";import"./chunk-CdEa0oLf.js";import{h as p}from"./chunk-CXF2jnNN.js";var X=ko.pie;var D={sections:new Map,showData:!1,config:X};var f=D.sections;var y=D.showData;var se=structuredClone(X);var ce=Ot(()=>structuredClone(se),`getConfig`);var de=Ot(()=>{f=new Map,y=D.showData,jo()},`clear`);var pe=Ot(({label:e,value:a})=>{if(a<0)throw new Error(`"${e}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);f.has(e)||(f.set(e,a),ct.debug(`added new section: ${e}, with value: ${a}`))},`addSection`);var ge=Ot(()=>f,`getSections`);var fe=Ot(e=>{y=e},`setShowData`);var ue=Ot(()=>y,`getShowData`);var Y={getConfig:ce,clear:de,setDiagramTitle:Zo,getDiagramTitle:Jo,setAccTitle:Vo,getAccTitle:Yo,setAccDescription:Xo,getAccDescription:Ko,addSection:pe,getSections:ge,setShowData:fe,getShowData:ue};var me=Ot((e,a)=>{t(e,a),a.setShowData(e.showData),e.sections.map(a.addSection)},`populateDb`);var he={parse:Ot(e=>G(null,null,function*(){let a=yield p(`pie`,e);ct.debug(a),me(a,Y)}),`parse`)};var Se=Ot(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,`getStyles`);var xe=Ot(e=>{let a=[...e.values()].reduce((r,l)=>r+l,0),$=[...e.entries()].map(([r,l])=>({label:r,value:l})).filter(r=>r.value/a*100>=1).sort((r,l)=>l.value-r.value);return Ec().value(r=>r.value)($)},`createPieArcs`);var _e={parser:he,db:Y,renderer:{draw:Ot((e,a$1,$,T)=>{ct.debug(`rendering pie chart
`+e);let r=T.db,l=ir(),A=dt(r.getConfig(),l.pie),b=40,n=18,s=450,u=s,m=a(a$1),c=m.append(`g`);c.attr(`transform`,`translate(225,225)`);let{themeVariables:i}=l,[E]=P(i.pieOuterStrokeWidth);E??=2;let _=A.textPosition,p=Math.min(u,s)/2-b,ee=Oc().innerRadius(0).outerRadius(p),te=Oc().innerRadius(p*_).outerRadius(p*_);c.append(`circle`).attr(`cx`,0).attr(`cy`,0).attr(`r`,p+E/2).attr(`class`,`pieOuterCircle`);let h=r.getSections(),ae=xe(h),re=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12],v=0;h.forEach(t=>{v+=t});let k=ae.filter(t=>(t.data.value/v*100).toFixed(0)!==`0`),S=ze(re);c.selectAll(`mySlices`).data(k).enter().append(`path`).attr(`d`,ee).attr(`fill`,t=>S(t.data.label)).attr(`class`,`pieCircle`),c.selectAll(`mySlices`).data(k).enter().append(`text`).text(t=>(t.data.value/v*100).toFixed(0)+`%`).attr(`transform`,t=>`translate(`+te.centroid(t)+`)`).style(`text-anchor`,`middle`).attr(`class`,`slice`),c.append(`text`).text(r.getDiagramTitle()).attr(`x`,0).attr(`y`,-200).attr(`class`,`pieTitleText`);let z=[...h.entries()].map(([t,w])=>({label:t,value:w})),x=c.selectAll(`.legend`).data(z).enter().append(`g`).attr(`class`,`legend`).attr(`transform`,(t,w)=>{let G=22,oe=G*z.length/2;return`translate(216,`+(w*G-oe)+`)`});x.append(`rect`).attr(`width`,n).attr(`height`,n).style(`fill`,t=>S(t.label)).style(`stroke`,t=>S(t.label)),x.append(`text`).attr(`x`,22).attr(`y`,14).text(t=>r.getShowData()?`${t.label} [${t.value}]`:t.label);let F=512+Math.max(...x.selectAll(`text`).nodes().map(t=>t?.getBoundingClientRect().width??0));m.attr(`viewBox`,`0 0 ${F} ${s}`),Ho(m,s,F,A.useMaxWidth)},`draw`)},styles:Se};export{_e as diagram};