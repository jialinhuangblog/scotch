import{s as G}from"./chunk-_AdZ4IJm.js";import{L as ct,v as Ot}from"./chunk-8Qsnq8Qv.js";import{K as jo,N as Zo,O as Xo,T as Vo,W as ir,f as Ko,j as Yo,p as Ks,u as Jo}from"./chunk-BeFDHBQf.js";import{a as St$1,g as zt$1}from"./chunk-C8D5vCXO.js";import{zt as C$1}from"./main-PD7QXSUG.js";import{t as g}from"./chunk-jJbbRhCN.js";import{t as g$1}from"./chunk-D1VFvPfx.js";var vt=(function(){var t=Ot(function(Y,a,c,r){for(c=c||{},r=Y.length;r--;c[Y[r]]=a);return c},`o`),e=[1,2],o=[1,3],s=[1,4],h=[2,4],u=[1,9],S=[1,11],g=[1,16],n=[1,17],T=[1,18],k=[1,19],A=[1,33],x=[1,20],D=[1,21],f=[1,22],m=[1,23],R=[1,24],L=[1,26],$=[1,27],I=[1,28],P=[1,29],et=[1,30],st=[1,31],it=[1,32],rt=[1,35],at=[1,36],nt=[1,37],ot=[1,38],j=[1,34],p=[1,4,5,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],lt=[1,4,5,14,15,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,39,40,41,45,48,51,52,53,54,57],xt=[4,5,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],gt={trace:Ot(function(){},`trace`),yy:{},symbols_:{error:2,start:3,SPACE:4,NL:5,SD:6,document:7,line:8,statement:9,classDefStatement:10,styleStatement:11,cssClassStatement:12,idStatement:13,DESCR:14,"-->":15,HIDE_EMPTY:16,scale:17,WIDTH:18,COMPOSIT_STATE:19,STRUCT_START:20,STRUCT_STOP:21,STATE_DESCR:22,AS:23,ID:24,FORK:25,JOIN:26,CHOICE:27,CONCURRENT:28,note:29,notePosition:30,NOTE_TEXT:31,direction:32,acc_title:33,acc_title_value:34,acc_descr:35,acc_descr_value:36,acc_descr_multiline_value:37,CLICK:38,STRING:39,HREF:40,classDef:41,CLASSDEF_ID:42,CLASSDEF_STYLEOPTS:43,DEFAULT:44,style:45,STYLE_IDS:46,STYLEDEF_STYLEOPTS:47,class:48,CLASSENTITY_IDS:49,STYLECLASS:50,direction_tb:51,direction_bt:52,direction_rl:53,direction_lr:54,eol:55,";":56,EDGE_STATE:57,STYLE_SEPARATOR:58,left_of:59,right_of:60,$accept:0,$end:1},terminals_:{2:`error`,4:`SPACE`,5:`NL`,6:`SD`,14:`DESCR`,15:`-->`,16:`HIDE_EMPTY`,17:`scale`,18:`WIDTH`,19:`COMPOSIT_STATE`,20:`STRUCT_START`,21:`STRUCT_STOP`,22:`STATE_DESCR`,23:`AS`,24:`ID`,25:`FORK`,26:`JOIN`,27:`CHOICE`,28:`CONCURRENT`,29:`note`,31:`NOTE_TEXT`,33:`acc_title`,34:`acc_title_value`,35:`acc_descr`,36:`acc_descr_value`,37:`acc_descr_multiline_value`,38:`CLICK`,39:`STRING`,40:`HREF`,41:`classDef`,42:`CLASSDEF_ID`,43:`CLASSDEF_STYLEOPTS`,44:`DEFAULT`,45:`style`,46:`STYLE_IDS`,47:`STYLEDEF_STYLEOPTS`,48:`class`,49:`CLASSENTITY_IDS`,50:`STYLECLASS`,51:`direction_tb`,52:`direction_bt`,53:`direction_rl`,54:`direction_lr`,56:`;`,57:`EDGE_STATE`,58:`STYLE_SEPARATOR`,59:`left_of`,60:`right_of`},productions_:[0,[3,2],[3,2],[3,2],[7,0],[7,2],[8,2],[8,1],[8,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,3],[9,4],[9,1],[9,2],[9,1],[9,4],[9,3],[9,6],[9,1],[9,1],[9,1],[9,1],[9,4],[9,4],[9,1],[9,2],[9,2],[9,1],[9,5],[9,5],[10,3],[10,3],[11,3],[12,3],[32,1],[32,1],[32,1],[32,1],[55,1],[55,1],[13,1],[13,1],[13,3],[13,3],[30,1],[30,1]],performAction:Ot(function(a,c,r,y,b,i,X){var l=i.length-1;switch(b){case 3:return y.setRootDoc(i[l]),i[l];case 4:this.$=[];break;case 5:i[l]!=`nl`&&(i[l-1].push(i[l]),this.$=i[l-1]);break;case 6:case 7:this.$=i[l];break;case 8:this.$=`nl`;break;case 12:this.$=i[l];break;case 13:let ht=i[l-1];ht.description=y.trimColon(i[l]),this.$=ht;break;case 14:this.$={stmt:`relation`,state1:i[l-2],state2:i[l]};break;case 15:let ut=y.trimColon(i[l]);this.$={stmt:`relation`,state1:i[l-3],state2:i[l-1],description:ut};break;case 19:this.$={stmt:`state`,id:i[l-3],type:`default`,description:``,doc:i[l-1]};break;case 20:var V=i[l],H=i[l-2].trim();if(i[l].match(`:`)){var J=i[l].split(`:`);V=J[0],H=[H,J[1]]}this.$={stmt:`state`,id:V,type:`default`,description:H};break;case 21:this.$={stmt:`state`,id:i[l-3],type:`default`,description:i[l-5],doc:i[l-1]};break;case 22:this.$={stmt:`state`,id:i[l],type:`fork`};break;case 23:this.$={stmt:`state`,id:i[l],type:`join`};break;case 24:this.$={stmt:`state`,id:i[l],type:`choice`};break;case 25:this.$={stmt:`state`,id:y.getDividerId(),type:`divider`};break;case 26:this.$={stmt:`state`,id:i[l-1].trim(),note:{position:i[l-2].trim(),text:i[l].trim()}};break;case 29:this.$=i[l].trim(),y.setAccTitle(this.$);break;case 30:case 31:this.$=i[l].trim(),y.setAccDescription(this.$);break;case 32:this.$={stmt:`click`,id:i[l-3],url:i[l-2],tooltip:i[l-1]};break;case 33:this.$={stmt:`click`,id:i[l-3],url:i[l-1],tooltip:``};break;case 34:case 35:this.$={stmt:`classDef`,id:i[l-1].trim(),classes:i[l].trim()};break;case 36:this.$={stmt:`style`,id:i[l-1].trim(),styleClass:i[l].trim()};break;case 37:this.$={stmt:`applyClass`,id:i[l-1].trim(),styleClass:i[l].trim()};break;case 38:y.setDirection(`TB`),this.$={stmt:`dir`,value:`TB`};break;case 39:y.setDirection(`BT`),this.$={stmt:`dir`,value:`BT`};break;case 40:y.setDirection(`RL`),this.$={stmt:`dir`,value:`RL`};break;case 41:y.setDirection(`LR`),this.$={stmt:`dir`,value:`LR`};break;case 44:case 45:this.$={stmt:`state`,id:i[l].trim(),type:`default`,description:``};break;case 46:this.$={stmt:`state`,id:i[l-2].trim(),classes:[i[l].trim()],type:`default`,description:``};break;case 47:this.$={stmt:`state`,id:i[l-2].trim(),classes:[i[l].trim()],type:`default`,description:``}}},`anonymous`),table:[{3:1,4:e,5:o,6:s},{1:[3]},{3:5,4:e,5:o,6:s},{3:6,4:e,5:o,6:s},t([1,4,5,16,17,19,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],h,{7:7}),{1:[2,1]},{1:[2,2]},{1:[2,3],4:u,5:S,8:8,9:10,10:12,11:13,12:14,13:15,16:g,17:n,19:T,22:k,24:A,25:x,26:D,27:f,28:m,29:R,32:25,33:L,35:$,37:I,38:P,41:et,45:st,48:it,51:rt,52:at,53:nt,54:ot,57:j},t(p,[2,5]),{9:39,10:12,11:13,12:14,13:15,16:g,17:n,19:T,22:k,24:A,25:x,26:D,27:f,28:m,29:R,32:25,33:L,35:$,37:I,38:P,41:et,45:st,48:it,51:rt,52:at,53:nt,54:ot,57:j},t(p,[2,7]),t(p,[2,8]),t(p,[2,9]),t(p,[2,10]),t(p,[2,11]),t(p,[2,12],{14:[1,40],15:[1,41]}),t(p,[2,16]),{18:[1,42]},t(p,[2,18],{20:[1,43]}),{23:[1,44]},t(p,[2,22]),t(p,[2,23]),t(p,[2,24]),t(p,[2,25]),{30:45,31:[1,46],59:[1,47],60:[1,48]},t(p,[2,28]),{34:[1,49]},{36:[1,50]},t(p,[2,31]),{13:51,24:A,57:j},{42:[1,52],44:[1,53]},{46:[1,54]},{49:[1,55]},t(lt,[2,44],{58:[1,56]}),t(lt,[2,45],{58:[1,57]}),t(p,[2,38]),t(p,[2,39]),t(p,[2,40]),t(p,[2,41]),t(p,[2,6]),t(p,[2,13]),{13:58,24:A,57:j},t(p,[2,17]),t(xt,h,{7:59}),{24:[1,60]},{24:[1,61]},{23:[1,62]},{24:[2,48]},{24:[2,49]},t(p,[2,29]),t(p,[2,30]),{39:[1,63],40:[1,64]},{43:[1,65]},{43:[1,66]},{47:[1,67]},{50:[1,68]},{24:[1,69]},{24:[1,70]},t(p,[2,14],{14:[1,71]}),{4:u,5:S,8:8,9:10,10:12,11:13,12:14,13:15,16:g,17:n,19:T,21:[1,72],22:k,24:A,25:x,26:D,27:f,28:m,29:R,32:25,33:L,35:$,37:I,38:P,41:et,45:st,48:it,51:rt,52:at,53:nt,54:ot,57:j},t(p,[2,20],{20:[1,73]}),{31:[1,74]},{24:[1,75]},{39:[1,76]},{39:[1,77]},t(p,[2,34]),t(p,[2,35]),t(p,[2,36]),t(p,[2,37]),t(lt,[2,46]),t(lt,[2,47]),t(p,[2,15]),t(p,[2,19]),t(xt,h,{7:78}),t(p,[2,26]),t(p,[2,27]),{5:[1,79]},{5:[1,80]},{4:u,5:S,8:8,9:10,10:12,11:13,12:14,13:15,16:g,17:n,19:T,21:[1,81],22:k,24:A,25:x,26:D,27:f,28:m,29:R,32:25,33:L,35:$,37:I,38:P,41:et,45:st,48:it,51:rt,52:at,53:nt,54:ot,57:j},t(p,[2,32]),t(p,[2,33]),t(p,[2,21])],defaultActions:{5:[2,1],6:[2,2],47:[2,48],48:[2,49]},parseError:Ot(function(a,c){if(c.recoverable)this.trace(a);else{var r=new Error(a);throw r.hash=c,r}},`parseError`),parse:Ot(function(a){var c=this,r=[0],y=[],b=[null],i=[],X=this.table,l=``,V=0,H=0,J=0,ht=2,ut=1,ue=i.slice.call(arguments,1),_=Object.create(this.lexer),M={yy:{}};for(var Tt in this.yy)Object.prototype.hasOwnProperty.call(this.yy,Tt)&&(M.yy[Tt]=this.yy[Tt]);_.setInput(a,M.yy),M.yy.lexer=_,M.yy.parser=this,typeof _.yylloc>`u`&&(_.yylloc={});var bt=_.yylloc;i.push(bt);var de=_.options&&_.options.ranges;typeof M.yy.parseError==`function`?this.parseError=M.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function fe(O){r.length=r.length-2*O,b.length=b.length-O,i.length=i.length-O}Ot(fe,`popStack`);function Lt(){var O=y.pop()||_.lex()||ut;return typeof O!=`number`&&(O instanceof Array&&(y=O,O=y.pop()),O=c.symbols_[O]||O),O}Ot(Lt,`lex`);for(var v,Et,U,N,_t,W={},dt,F,It,ft;;){if(U=r[r.length-1],this.defaultActions[U]?N=this.defaultActions[U]:((v===null||typeof v>`u`)&&(v=Lt()),N=X[U]&&X[U][v]),typeof N>`u`||!N.length||!N[0]){var kt=``;ft=[];for(dt in X[U])this.terminals_[dt]&&dt>ht&&ft.push(`'`+this.terminals_[dt]+`'`);_.showPosition?kt=`Parse error on line `+(V+1)+`:
`+_.showPosition()+`
Expecting `+ft.join(`, `)+`, got '`+(this.terminals_[v]||v)+`'`:kt=`Parse error on line `+(V+1)+`: Unexpected `+(v==ut?`end of input`:`'`+(this.terminals_[v]||v)+`'`),this.parseError(kt,{text:_.match,token:this.terminals_[v]||v,line:_.yylineno,loc:bt,expected:ft})}if(N[0]instanceof Array&&N.length>1)throw new Error(`Parse Error: multiple actions possible at state: `+U+`, token: `+v);switch(N[0]){case 1:r.push(v),b.push(_.yytext),i.push(_.yylloc),r.push(N[1]),v=null,Et?(v=Et,Et=null):(H=_.yyleng,l=_.yytext,V=_.yylineno,bt=_.yylloc,J>0&&J--);break;case 2:if(F=this.productions_[N[1]][1],W.$=b[b.length-F],W._$={first_line:i[i.length-(F||1)].first_line,last_line:i[i.length-1].last_line,first_column:i[i.length-(F||1)].first_column,last_column:i[i.length-1].last_column},de&&(W._$.range=[i[i.length-(F||1)].range[0],i[i.length-1].range[1]]),_t=this.performAction.apply(W,[l,H,V,M.yy,N[1],b,i].concat(ue)),typeof _t<`u`)return _t;F&&(r=r.slice(0,-1*F*2),b=b.slice(0,-1*F),i=i.slice(0,-1*F)),r.push(this.productions_[N[1]][0]),b.push(W.$),i.push(W._$),It=X[r[r.length-2]][r[r.length-1]],r.push(It);break;case 3:return!0}}return!0},`parse`)};gt.lexer=(function(){return{EOF:1,parseError:Ot(function(c,r){if(this.yy.parser)this.yy.parser.parseError(c,r);else throw new Error(c)},`parseError`),setInput:Ot(function(a,c){return this.yy=c||this.yy||{},this._input=a,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match=``,this.conditionStack=[`INITIAL`],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},`setInput`),input:Ot(function(){var a=this._input[0];this.yytext+=a,this.yyleng++,this.offset++,this.match+=a,this.matched+=a;return a.match(/(?:\r\n?|\n).*/g)?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),a},`input`),unput:Ot(function(a){var c=a.length,r=a.split(/(?:\r\n?|\n)/g);this._input=a+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-c),this.offset-=c;var y=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),r.length-1&&(this.yylineno-=r.length-1);var b=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:r?(r.length===y.length?this.yylloc.first_column:0)+y[y.length-r.length].length-r[0].length:this.yylloc.first_column-c},this.options.ranges&&(this.yylloc.range=[b[0],b[0]+this.yyleng-c]),this.yyleng=this.yytext.length,this},`unput`),more:Ot(function(){return this._more=!0,this},`more`),reject:Ot(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError(`Lexical error on line `+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:``,token:null,line:this.yylineno});return this},`reject`),less:Ot(function(a){this.unput(this.match.slice(a))},`less`),pastInput:Ot(function(){var a=this.matched.substr(0,this.matched.length-this.match.length);return(a.length>20?`...`:``)+a.substr(-20).replace(/\n/g,``)},`pastInput`),upcomingInput:Ot(function(){var a=this.match;return a.length<20&&(a+=this._input.substr(0,20-a.length)),(a.substr(0,20)+(a.length>20?`...`:``)).replace(/\n/g,``)},`upcomingInput`),showPosition:Ot(function(){var a=this.pastInput(),c=new Array(a.length+1).join(`-`);return a+this.upcomingInput()+`
`+c+`^`},`showPosition`),test_match:Ot(function(a,c){var r,y,b;if(this.options.backtrack_lexer&&(b={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(b.yylloc.range=this.yylloc.range.slice(0))),y=a[0].match(/(?:\r\n?|\n).*/g),y&&(this.yylineno+=y.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:y?y[y.length-1].length-y[y.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+a[0].length},this.yytext+=a[0],this.match+=a[0],this.matches=a,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(a[0].length),this.matched+=a[0],r=this.performAction.call(this,this.yy,this,c,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),r)return r;if(this._backtrack){for(var i in b)this[i]=b[i];return!1}return!1},`test_match`),next:Ot(function(){if(this.done)return this.EOF;this._input||(this.done=!0);var a,c,r,y;this._more||(this.yytext=``,this.match=``);for(var b=this._currentRules(),i=0;i<b.length;i++)if(r=this._input.match(this.rules[b[i]]),r&&(!c||r[0].length>c[0].length)){if(c=r,y=i,this.options.backtrack_lexer){if(a=this.test_match(r,b[i]),a!==!1)return a;if(this._backtrack){c=!1;continue}else return!1}else if(!this.options.flex)break}return c?(a=this.test_match(c,b[y]),a!==!1?a:!1):this._input===``?this.EOF:this.parseError(`Lexical error on line `+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:``,token:null,line:this.yylineno})},`next`),lex:Ot(function(){return this.next()||this.lex()},`lex`),begin:Ot(function(c){this.conditionStack.push(c)},`begin`),popState:Ot(function(){return this.conditionStack.length-1>0?this.conditionStack.pop():this.conditionStack[0]},`popState`),_currentRules:Ot(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},`_currentRules`),topState:Ot(function(c){return c=this.conditionStack.length-1-Math.abs(c||0),c>=0?this.conditionStack[c]:`INITIAL`},`topState`),pushState:Ot(function(c){this.begin(c)},`pushState`),stateStackSize:Ot(function(){return this.conditionStack.length},`stateStackSize`),options:{"case-insensitive":!0},performAction:Ot(function(c,r,y,b){switch(y){case 0:return 38;case 1:return 40;case 2:return 39;case 3:return 44;case 4:return 51;case 5:return 52;case 6:return 53;case 7:return 54;case 8:break;case 9:break;case 10:return 5;case 11:break;case 12:break;case 13:break;case 14:break;case 15:return this.pushState(`SCALE`),17;case 16:return 18;case 17:this.popState();break;case 18:return this.begin(`acc_title`),33;case 19:return this.popState(),`acc_title_value`;case 20:return this.begin(`acc_descr`),35;case 21:return this.popState(),`acc_descr_value`;case 22:this.begin(`acc_descr_multiline`);break;case 23:this.popState();break;case 24:return`acc_descr_multiline_value`;case 25:return this.pushState(`CLASSDEF`),41;case 26:return this.popState(),this.pushState(`CLASSDEFID`),`DEFAULT_CLASSDEF_ID`;case 27:return this.popState(),this.pushState(`CLASSDEFID`),42;case 28:return this.popState(),43;case 29:return this.pushState(`CLASS`),48;case 30:return this.popState(),this.pushState(`CLASS_STYLE`),49;case 31:return this.popState(),50;case 32:return this.pushState(`STYLE`),45;case 33:return this.popState(),this.pushState(`STYLEDEF_STYLES`),46;case 34:return this.popState(),47;case 35:return this.pushState(`SCALE`),17;case 36:return 18;case 37:this.popState();break;case 38:this.pushState(`STATE`);break;case 39:return this.popState(),r.yytext=r.yytext.slice(0,-8).trim(),25;case 40:return this.popState(),r.yytext=r.yytext.slice(0,-8).trim(),26;case 41:return this.popState(),r.yytext=r.yytext.slice(0,-10).trim(),27;case 42:return this.popState(),r.yytext=r.yytext.slice(0,-8).trim(),25;case 43:return this.popState(),r.yytext=r.yytext.slice(0,-8).trim(),26;case 44:return this.popState(),r.yytext=r.yytext.slice(0,-10).trim(),27;case 45:return 51;case 46:return 52;case 47:return 53;case 48:return 54;case 49:this.pushState(`STATE_STRING`);break;case 50:return this.pushState(`STATE_ID`),`AS`;case 51:return this.popState(),`ID`;case 52:this.popState();break;case 53:return`STATE_DESCR`;case 54:return 19;case 55:this.popState();break;case 56:return this.popState(),this.pushState(`struct`),20;case 57:break;case 58:return this.popState(),21;case 59:break;case 60:return this.begin(`NOTE`),29;case 61:return this.popState(),this.pushState(`NOTE_ID`),59;case 62:return this.popState(),this.pushState(`NOTE_ID`),60;case 63:this.popState(),this.pushState(`FLOATING_NOTE`);break;case 64:return this.popState(),this.pushState(`FLOATING_NOTE_ID`),`AS`;case 65:break;case 66:return`NOTE_TEXT`;case 67:return this.popState(),`ID`;case 68:return this.popState(),this.pushState(`NOTE_TEXT`),24;case 69:return this.popState(),r.yytext=r.yytext.substr(2).trim(),31;case 70:return this.popState(),r.yytext=r.yytext.slice(0,-8).trim(),31;case 71:return 6;case 72:return 6;case 73:return 16;case 74:return 57;case 75:return 24;case 76:return r.yytext=r.yytext.trim(),14;case 77:return 15;case 78:return 28;case 79:return 58;case 80:return 5;case 81:return`INVALID`}},`anonymous`),rules:[/^(?:click\b)/i,/^(?:href\b)/i,/^(?:"[^"]*")/i,/^(?:default\b)/i,/^(?:.*direction\s+TB[^\n]*)/i,/^(?:.*direction\s+BT[^\n]*)/i,/^(?:.*direction\s+RL[^\n]*)/i,/^(?:.*direction\s+LR[^\n]*)/i,/^(?:%%(?!\{)[^\n]*)/i,/^(?:[^\}]%%[^\n]*)/i,/^(?:[\n]+)/i,/^(?:[\s]+)/i,/^(?:((?!\n)\s)+)/i,/^(?:#[^\n]*)/i,/^(?:%[^\n]*)/i,/^(?:scale\s+)/i,/^(?:\d+)/i,/^(?:\s+width\b)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:classDef\s+)/i,/^(?:DEFAULT\s+)/i,/^(?:\w+\s+)/i,/^(?:[^\n]*)/i,/^(?:class\s+)/i,/^(?:(\w+)+((,\s*\w+)*))/i,/^(?:[^\n]*)/i,/^(?:style\s+)/i,/^(?:[\w,]+\s+)/i,/^(?:[^\n]*)/i,/^(?:scale\s+)/i,/^(?:\d+)/i,/^(?:\s+width\b)/i,/^(?:state\s+)/i,/^(?:.*<<fork>>)/i,/^(?:.*<<join>>)/i,/^(?:.*<<choice>>)/i,/^(?:.*\[\[fork\]\])/i,/^(?:.*\[\[join\]\])/i,/^(?:.*\[\[choice\]\])/i,/^(?:.*direction\s+TB[^\n]*)/i,/^(?:.*direction\s+BT[^\n]*)/i,/^(?:.*direction\s+RL[^\n]*)/i,/^(?:.*direction\s+LR[^\n]*)/i,/^(?:["])/i,/^(?:\s*as\s+)/i,/^(?:[^\n\{]*)/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:[^\n\s\{]+)/i,/^(?:\n)/i,/^(?:\{)/i,/^(?:%%(?!\{)[^\n]*)/i,/^(?:\})/i,/^(?:[\n])/i,/^(?:note\s+)/i,/^(?:left of\b)/i,/^(?:right of\b)/i,/^(?:")/i,/^(?:\s*as\s*)/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:[^\n]*)/i,/^(?:\s*[^:\n\s\-]+)/i,/^(?:\s*:[^:\n;]+)/i,/^(?:[\s\S]*?end note\b)/i,/^(?:stateDiagram\s+)/i,/^(?:stateDiagram-v2\s+)/i,/^(?:hide empty description\b)/i,/^(?:\[\*\])/i,/^(?:[^:\n\s\-\{]+)/i,/^(?:\s*:(?:[^:\n;]|:[^:\n;])+)/i,/^(?:-->)/i,/^(?:--)/i,/^(?::::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{LINE:{rules:[12,13],inclusive:!1},struct:{rules:[12,13,25,29,32,38,45,46,47,48,57,58,59,60,74,75,76,77,78],inclusive:!1},FLOATING_NOTE_ID:{rules:[67],inclusive:!1},FLOATING_NOTE:{rules:[64,65,66],inclusive:!1},NOTE_TEXT:{rules:[69,70],inclusive:!1},NOTE_ID:{rules:[68],inclusive:!1},NOTE:{rules:[61,62,63],inclusive:!1},STYLEDEF_STYLEOPTS:{rules:[],inclusive:!1},STYLEDEF_STYLES:{rules:[34],inclusive:!1},STYLE_IDS:{rules:[],inclusive:!1},STYLE:{rules:[33],inclusive:!1},CLASS_STYLE:{rules:[31],inclusive:!1},CLASS:{rules:[30],inclusive:!1},CLASSDEFID:{rules:[28],inclusive:!1},CLASSDEF:{rules:[26,27],inclusive:!1},acc_descr_multiline:{rules:[23,24],inclusive:!1},acc_descr:{rules:[21],inclusive:!1},acc_title:{rules:[19],inclusive:!1},SCALE:{rules:[16,17,36,37],inclusive:!1},ALIAS:{rules:[],inclusive:!1},STATE_ID:{rules:[51],inclusive:!1},STATE_STRING:{rules:[52,53],inclusive:!1},FORK_STATE:{rules:[],inclusive:!1},STATE:{rules:[12,13,39,40,41,42,43,44,49,50,54,55,56],inclusive:!1},ID:{rules:[12,13],inclusive:!1},INITIAL:{rules:[0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,18,20,22,25,29,32,35,38,56,60,71,72,73,74,75,76,77,79,80,81],inclusive:!0}}}})();function ct(){this.yy={}}return Ot(ct,`Parser`),ct.prototype=gt,gt.Parser=ct,new ct})();vt.parser=vt;var We=vt;var pe=`TB`;var qt=`TB`;var jt=`dir`;var K=`state`;var z=`root`;var Ct=`relation`;var Se=`classDef`;var ye=`style`;var ge=`applyClass`;var Z=`default`;var Qt=`divider`;var Zt=`fill:none`;var te=`fill: #333`;var ee=`c`;var se=`markdown`;var ie=`normal`;var mt=`rect`;var Dt=`rectWithTitle`;var Te=`stateStart`;var be=`stateEnd`;var Ht=`divider`;var Wt=`roundedWithTitle`;var Ee=`note`;var _e=`noteGroup`;var tt=`statediagram`;var me=`${tt}-state`;var re=`transition`;var De=`note`;var Ce=`${re} note-edge`;var Ae=`${tt}-${De}`;var Le=`${tt}-cluster`;var Oe=`${tt}-cluster-alt`;var ae=`parent`;var ne=`note`;var Re=`state`;var At=`----`;var Ne=`${At}${ne}`;var zt=`${At}${ae}`;var oe=Ot((t,e=qt)=>{if(!t.doc)return e;let o=e;for(let s of t.doc)s.stmt===`dir`&&(o=s.value);return o},`getDir`);var ze={getClasses:Ot(function(t,e){return e.db.getClasses()},`getClasses`),draw:Ot(function(t,e,o,s){return G(this,null,function*(){ct.info(`REF0:`),ct.info(`Drawing state diagram (v2)`,e);let{securityLevel:h,state:u,layout:S}=ir();s.db.extract(s.db.getRootDocV2());let g$2=s.db.getData(),n=g$1(e,h);g$2.type=s.type,g$2.layoutAlgorithm=S,g$2.nodeSpacing=u?.nodeSpacing||50,g$2.rankSpacing=u?.rankSpacing||50,g$2.markers=[`barb`],g$2.diagramId=e,yield C$1(g$2,n);let T=8;try{(typeof s.db.getLinks==`function`?s.db.getLinks():new Map).forEach((A,x)=>{let D=typeof x==`string`?x:typeof x?.id==`string`?x.id:``;if(!D){ct.warn(`⚠️ Invalid or missing stateId from key:`,JSON.stringify(x));return}let f=n.node()?.querySelectorAll(`g`),m;if(f?.forEach(I=>{I.textContent?.trim()===D&&(m=I)}),!m){ct.warn(`⚠️ Could not find node matching text:`,D);return}let R=m.parentNode;if(!R){ct.warn(`⚠️ Node has no parent, cannot wrap:`,D);return}let L=document.createElementNS(`http://www.w3.org/2000/svg`,`a`),$=A.url.replace(/^"+|"+$/g,``);if(L.setAttributeNS(`http://www.w3.org/1999/xlink`,`xlink:href`,$),L.setAttribute(`target`,`_blank`),A.tooltip){let I=A.tooltip.replace(/^"+|"+$/g,``);L.setAttribute(`title`,I)}R.replaceChild(L,m),L.appendChild(m),ct.info(`🔗 Wrapped node in <a> tag for:`,D,A.url)})}catch(k){ct.error(`❌ Error injecting clickable links:`,k)}zt$1.insertTitle(n,`statediagramTitleText`,u?.titleTopMargin??25,s.db.getDiagramTitle()),g(n,T,tt,u?.useMaxWidth??!0)})},`draw`),getDir:oe};var St=new Map;var B=0;function yt(t=``,e=0,o=``,s=At){return`${Re}-${t}${o!==null&&o.length>0?`${s}${o}`:``}-${e}`}Ot(yt,`stateDomId`);var Pe=Ot((t,e,o,s,h,u,S,g)=>{ct.trace(`items`,e),e.forEach(n=>{switch(n.stmt){case K:Q(t,n,o,s,h,u,S,g);break;case Z:Q(t,n,o,s,h,u,S,g);break;case Ct:{Q(t,n.state1,o,s,h,u,S,g),Q(t,n.state2,o,s,h,u,S,g);let T={id:`edge`+B,start:n.state1.id,end:n.state2.id,arrowhead:`normal`,arrowTypeEnd:`arrow_barb`,style:Zt,labelStyle:``,label:Ks.sanitizeText(n.description??``,ir()),arrowheadStyle:te,labelpos:ee,labelType:se,thickness:ie,classes:re,look:S};h.push(T),B++}}})},`setupDoc`);var Kt=Ot((t,e=qt)=>{let o=e;if(t.doc)for(let s of t.doc)s.stmt===`dir`&&(o=s.value);return o},`getDir`);function q(t,e,o){if(!e.id||e.id===`</join></fork>`||e.id===`</choice>`)return;e.cssClasses&&(Array.isArray(e.cssCompiledStyles)||(e.cssCompiledStyles=[]),e.cssClasses.split(` `).forEach(h=>{let u=o.get(h);u&&(e.cssCompiledStyles=[...e.cssCompiledStyles??[],...u.styles])}));let s=t.find(h=>h.id===e.id);s?Object.assign(s,e):t.push(e)}Ot(q,`insertOrUpdateNode`);function le(t){return t?.classes?.join(` `)??``}Ot(le,`getClassesFromDbInfo`);function ce(t){return t?.styles??[]}Ot(ce,`getStylesFromDbInfo`);var Q=Ot((t,e,o,s,h,u,S,g)=>{let n=e.id,T=o.get(n),k=le(T),A=ce(T),x=ir();if(ct.info(`dataFetcher parsedItem`,e,T,A),n!==`root`){let D=mt;e.start===!0?D=Te:e.start===!1&&(D=be),e.type!==Z&&(D=e.type),St.get(n)||St.set(n,{id:n,shape:D,description:Ks.sanitizeText(n,x),cssClasses:`${k} ${me}`,cssStyles:A});let f=St.get(n);e.description&&(Array.isArray(f.description)?(f.shape=Dt,f.description.push(e.description)):f.description?.length&&f.description.length>0?(f.shape=Dt,f.description===n?f.description=[e.description]:f.description=[f.description,e.description]):(f.shape=mt,f.description=e.description),f.description=Ks.sanitizeTextOrArray(f.description,x)),f.description?.length===1&&f.shape===Dt&&(f.type===`group`?f.shape=Wt:f.shape=mt),!f.type&&e.doc&&(ct.info(`Setting cluster for XCX`,n,Kt(e)),f.type=`group`,f.isGroup=!0,f.dir=Kt(e),f.shape=e.type===Qt?Ht:Wt,f.cssClasses=`${f.cssClasses} ${Le} ${u?Oe:``}`);let m={labelStyle:``,shape:f.shape,label:f.description,cssClasses:f.cssClasses,cssCompiledStyles:[],cssStyles:f.cssStyles,id:n,dir:f.dir,domId:yt(n,B),type:f.type,isGroup:f.type===`group`,padding:8,rx:10,ry:10,look:S,labelType:`markdown`};if(m.shape===Ht&&(m.label=``),t&&t.id!==`root`&&(ct.trace(`Setting node `,n,` to be child of its parent `,t.id),m.parentId=t.id),m.centerLabel=!0,e.note){let R={labelStyle:``,shape:Ee,label:e.note.text,labelType:`markdown`,cssClasses:Ae,cssStyles:[],cssCompiledStyles:[],id:n+Ne+`-`+B,domId:yt(n,B,ne),type:f.type,isGroup:f.type===`group`,padding:x.flowchart?.padding,look:S,position:e.note.position},L=n+zt,$={labelStyle:``,shape:_e,label:e.note.text,cssClasses:f.cssClasses,cssStyles:[],id:n+zt,domId:yt(n,B,ae),type:`group`,isGroup:!0,padding:16,look:S,position:e.note.position};B++,$.id=L,R.parentId=L,q(s,$,g),q(s,R,g),q(s,m,g);let I=n,P=R.id;e.note.position===`left of`&&(I=R.id,P=n),h.push({id:I+`-`+P,start:I,end:P,arrowhead:`none`,arrowTypeEnd:``,style:Zt,labelStyle:``,classes:Ce,arrowheadStyle:te,labelpos:ee,labelType:se,thickness:ie,look:S})}else q(s,m,g)}e.doc&&(ct.trace(`Adding nodes children `),Pe(e,e.doc,o,s,h,!u,S,g))},`dataFetcher`);var Fe=Ot(()=>{St.clear(),B=0},`reset`);var C={START_NODE:`[*]`,START_TYPE:`start`,END_NODE:`[*]`,END_TYPE:`end`,COLOR_KEYWORD:`color`,FILL_KEYWORD:`fill`,BG_FILL:`bgFill`,STYLECLASS_SEP:`,`};var Xt=Ot(()=>new Map,`newClassesList`);var Jt=Ot(()=>({relations:[],states:new Map,documents:{}}),`newDoc`);var pt=Ot(t=>JSON.parse(JSON.stringify(t)),`clone`);var Ke=class{constructor(t){this.version=t,this.nodes=[],this.edges=[],this.rootDoc=[],this.classes=Xt(),this.documents={root:Jt()},this.currentDocument=this.documents.root,this.startEndCount=0,this.dividerCnt=0,this.links=new Map,this.getAccTitle=Yo,this.setAccTitle=Vo,this.getAccDescription=Ko,this.setAccDescription=Xo,this.setDiagramTitle=Zo,this.getDiagramTitle=Jo,this.clear(),this.setRootDoc=this.setRootDoc.bind(this),this.getDividerId=this.getDividerId.bind(this),this.setDirection=this.setDirection.bind(this),this.trimColon=this.trimColon.bind(this)}static{Ot(this,`StateDB`)}static{this.relationType={AGGREGATION:0,EXTENSION:1,COMPOSITION:2,DEPENDENCY:3}}extract(t){this.clear(!0);for(let s of Array.isArray(t)?t:t.doc)switch(s.stmt){case K:this.addState(s.id.trim(),s.type,s.doc,s.description,s.note);break;case Ct:this.addRelation(s.state1,s.state2,s.description);break;case Se:this.addStyleClass(s.id.trim(),s.classes);break;case ye:this.handleStyleDef(s);break;case ge:this.setCssClass(s.id.trim(),s.styleClass);break;case`click`:this.addLink(s.id,s.url,s.tooltip)}let e=this.getStates(),o=ir();Fe(),Q(void 0,this.getRootDocV2(),e,this.nodes,this.edges,!0,o.look,this.classes);for(let s of this.nodes)if(Array.isArray(s.label)){if(s.description=s.label.slice(1),s.isGroup&&s.description.length>0)throw new Error(`Group nodes can only have label. Remove the additional description for node [${s.id}]`);s.label=s.label[0]}}handleStyleDef(t){let e=t.id.trim().split(`,`),o=t.styleClass.split(`,`);for(let s of e){let h=this.getState(s);if(!h){let u=s.trim();this.addState(u),h=this.getState(u)}h&&(h.styles=o.map(u=>u.replace(/;/g,``)?.trim()))}}setRootDoc(t){ct.info(`Setting root doc`,t),this.rootDoc=t,this.version===1?this.extract(t):this.extract(this.getRootDocV2())}docTranslator(t,e,o){if(e.stmt===Ct){this.docTranslator(t,e.state1,!0),this.docTranslator(t,e.state2,!1);return}if(e.stmt===K&&(e.id===C.START_NODE?(e.id=t.id+(o?`_start`:`_end`),e.start=o):e.id=e.id.trim()),e.stmt!==z&&e.stmt!==K||!e.doc)return;let s=[],h=[];for(let u of e.doc)if(u.type===Qt){let S=pt(u);S.doc=pt(h),s.push(S),h=[]}else h.push(u);if(s.length>0&&h.length>0){let u={stmt:K,id:St$1(),type:`divider`,doc:pt(h)};s.push(pt(u)),e.doc=s}e.doc.forEach(u=>this.docTranslator(e,u,!0))}getRootDocV2(){return this.docTranslator({id:z,stmt:z},{id:z,stmt:z,doc:this.rootDoc},!0),{id:z,doc:this.rootDoc}}addState(t,e=Z,o=void 0,s=void 0,h=void 0,u=void 0,S=void 0,g=void 0){let n=t?.trim();if(!this.currentDocument.states.has(n))ct.info(`Adding state `,n,s),this.currentDocument.states.set(n,{stmt:K,id:n,descriptions:[],type:e,doc:o,note:h,classes:[],styles:[],textStyles:[]});else{let T=this.currentDocument.states.get(n);if(!T)throw new Error(`State not found: ${n}`);T.doc||(T.doc=o),T.type||(T.type=e)}if(s&&(ct.info(`Setting state description`,n,s),(Array.isArray(s)?s:[s]).forEach(k=>this.addDescription(n,k.trim()))),h){let T=this.currentDocument.states.get(n);if(!T)throw new Error(`State not found: ${n}`);T.note=h,T.note.text=Ks.sanitizeText(T.note.text,ir())}u&&(ct.info(`Setting state classes`,n,u),(Array.isArray(u)?u:[u]).forEach(k=>this.setCssClass(n,k.trim()))),S&&(ct.info(`Setting state styles`,n,S),(Array.isArray(S)?S:[S]).forEach(k=>this.setStyle(n,k.trim()))),g&&(ct.info(`Setting state styles`,n,S),(Array.isArray(g)?g:[g]).forEach(k=>this.setTextStyle(n,k.trim())))}clear(t){this.nodes=[],this.edges=[],this.documents={root:Jt()},this.currentDocument=this.documents.root,this.startEndCount=0,this.classes=Xt(),t||(this.links=new Map,jo())}getState(t){return this.currentDocument.states.get(t)}getStates(){return this.currentDocument.states}logDocuments(){ct.info(`Documents = `,this.documents)}getRelations(){return this.currentDocument.relations}addLink(t,e,o){this.links.set(t,{url:e,tooltip:o}),ct.warn(`Adding link`,t,e,o)}getLinks(){return this.links}startIdIfNeeded(t=``){return t===C.START_NODE?(this.startEndCount++,`${C.START_TYPE}${this.startEndCount}`):t}startTypeIfNeeded(t=``,e=Z){return t===C.START_NODE?C.START_TYPE:e}endIdIfNeeded(t=``){return t===C.END_NODE?(this.startEndCount++,`${C.END_TYPE}${this.startEndCount}`):t}endTypeIfNeeded(t=``,e=Z){return t===C.END_NODE?C.END_TYPE:e}addRelationObjs(t,e,o=``){let s=this.startIdIfNeeded(t.id.trim()),h=this.startTypeIfNeeded(t.id.trim(),t.type),u=this.startIdIfNeeded(e.id.trim()),S=this.startTypeIfNeeded(e.id.trim(),e.type);this.addState(s,h,t.doc,t.description,t.note,t.classes,t.styles,t.textStyles),this.addState(u,S,e.doc,e.description,e.note,e.classes,e.styles,e.textStyles),this.currentDocument.relations.push({id1:s,id2:u,relationTitle:Ks.sanitizeText(o,ir())})}addRelation(t,e,o){if(typeof t==`object`&&typeof e==`object`)this.addRelationObjs(t,e,o);else if(typeof t==`string`&&typeof e==`string`){let s=this.startIdIfNeeded(t.trim()),h=this.startTypeIfNeeded(t),u=this.endIdIfNeeded(e.trim()),S=this.endTypeIfNeeded(e);this.addState(s,h),this.addState(u,S),this.currentDocument.relations.push({id1:s,id2:u,relationTitle:o?Ks.sanitizeText(o,ir()):void 0})}}addDescription(t,e){let o=this.currentDocument.states.get(t),s=e.startsWith(`:`)?e.replace(`:`,``).trim():e;o?.descriptions?.push(Ks.sanitizeText(s,ir()))}cleanupLabel(t){return t.startsWith(`:`)?t.slice(2).trim():t.trim()}getDividerId(){return this.dividerCnt++,`divider-id-${this.dividerCnt}`}addStyleClass(t,e=``){this.classes.has(t)||this.classes.set(t,{id:t,styles:[],textStyles:[]});let o=this.classes.get(t);e&&o&&e.split(C.STYLECLASS_SEP).forEach(s=>{let h=s.replace(/([^;]*);/,`$1`).trim();if(RegExp(C.COLOR_KEYWORD).exec(s)){let S=h.replace(C.FILL_KEYWORD,C.BG_FILL).replace(C.COLOR_KEYWORD,C.FILL_KEYWORD);o.textStyles.push(S)}o.styles.push(h)})}getClasses(){return this.classes}setCssClass(t,e){t.split(`,`).forEach(o=>{let s=this.getState(o);if(!s){let h=o.trim();this.addState(h),s=this.getState(h)}s?.classes?.push(e)})}setStyle(t,e){this.getState(t)?.styles?.push(e)}setTextStyle(t,e){this.getState(t)?.textStyles?.push(e)}getDirectionStatement(){return this.rootDoc.find(t=>t.stmt===jt)}getDirection(){return this.getDirectionStatement()?.value??pe}setDirection(t){let e=this.getDirectionStatement();e?e.value=t:this.rootDoc.unshift({stmt:jt,value:t})}trimColon(t){return t.startsWith(`:`)?t.slice(1).trim():t.trim()}getData(){let t=ir();return{nodes:this.nodes,edges:this.edges,other:{},config:t,direction:oe(this.getRootDocV2())}}getConfig(){return ir().state}};var Xe=Ot(t=>`
defs #statediagram-barbEnd {
    fill: ${t.transitionColor};
    stroke: ${t.transitionColor};
  }
g.stateGroup text {
  fill: ${t.nodeBorder};
  stroke: none;
  font-size: 10px;
}
g.stateGroup text {
  fill: ${t.textColor};
  stroke: none;
  font-size: 10px;

}
g.stateGroup .state-title {
  font-weight: bolder;
  fill: ${t.stateLabelColor};
}

g.stateGroup rect {
  fill: ${t.mainBkg};
  stroke: ${t.nodeBorder};
}

g.stateGroup line {
  stroke: ${t.lineColor};
  stroke-width: 1;
}

.transition {
  stroke: ${t.transitionColor};
  stroke-width: 1;
  fill: none;
}

.stateGroup .composit {
  fill: ${t.background};
  border-bottom: 1px
}

.stateGroup .alt-composit {
  fill: #e0e0e0;
  border-bottom: 1px
}

.state-note {
  stroke: ${t.noteBorderColor};
  fill: ${t.noteBkgColor};

  text {
    fill: ${t.noteTextColor};
    stroke: none;
    font-size: 10px;
  }
}

.stateLabel .box {
  stroke: none;
  stroke-width: 0;
  fill: ${t.mainBkg};
  opacity: 0.5;
}

.edgeLabel .label rect {
  fill: ${t.labelBackgroundColor};
  opacity: 0.5;
}
.edgeLabel {
  background-color: ${t.edgeLabelBackground};
  p {
    background-color: ${t.edgeLabelBackground};
  }
  rect {
    opacity: 0.5;
    background-color: ${t.edgeLabelBackground};
    fill: ${t.edgeLabelBackground};
  }
  text-align: center;
}
.edgeLabel .label text {
  fill: ${t.transitionLabelColor||t.tertiaryTextColor};
}
.label div .edgeLabel {
  color: ${t.transitionLabelColor||t.tertiaryTextColor};
}

.stateLabel text {
  fill: ${t.stateLabelColor};
  font-size: 10px;
  font-weight: bold;
}

.node circle.state-start {
  fill: ${t.specialStateColor};
  stroke: ${t.specialStateColor};
}

.node .fork-join {
  fill: ${t.specialStateColor};
  stroke: ${t.specialStateColor};
}

.node circle.state-end {
  fill: ${t.innerEndBackground};
  stroke: ${t.background};
  stroke-width: 1.5
}
.end-state-inner {
  fill: ${t.compositeBackground||t.background};
  // stroke: ${t.background};
  stroke-width: 1.5
}

.node rect {
  fill: ${t.stateBkg||t.mainBkg};
  stroke: ${t.stateBorder||t.nodeBorder};
  stroke-width: 1px;
}
.node polygon {
  fill: ${t.mainBkg};
  stroke: ${t.stateBorder||t.nodeBorder};;
  stroke-width: 1px;
}
#statediagram-barbEnd {
  fill: ${t.lineColor};
}

.statediagram-cluster rect {
  fill: ${t.compositeTitleBackground};
  stroke: ${t.stateBorder||t.nodeBorder};
  stroke-width: 1px;
}

.cluster-label, .nodeLabel {
  color: ${t.stateLabelColor};
  // line-height: 1;
}

.statediagram-cluster rect.outer {
  rx: 5px;
  ry: 5px;
}
.statediagram-state .divider {
  stroke: ${t.stateBorder||t.nodeBorder};
}

.statediagram-state .title-state {
  rx: 5px;
  ry: 5px;
}
.statediagram-cluster.statediagram-cluster .inner {
  fill: ${t.compositeBackground||t.background};
}
.statediagram-cluster.statediagram-cluster-alt .inner {
  fill: ${t.altBackground?t.altBackground:`#efefef`};
}

.statediagram-cluster .inner {
  rx:0;
  ry:0;
}

.statediagram-state rect.basic {
  rx: 5px;
  ry: 5px;
}
.statediagram-state rect.divider {
  stroke-dasharray: 10,10;
  fill: ${t.altBackground?t.altBackground:`#efefef`};
}

.note-edge {
  stroke-dasharray: 5;
}

.statediagram-note rect {
  fill: ${t.noteBkgColor};
  stroke: ${t.noteBorderColor};
  stroke-width: 1px;
  rx: 0;
  ry: 0;
}
.statediagram-note rect {
  fill: ${t.noteBkgColor};
  stroke: ${t.noteBorderColor};
  stroke-width: 1px;
  rx: 0;
  ry: 0;
}

.statediagram-note text {
  fill: ${t.noteTextColor};
}

.statediagram-note .nodeLabel {
  color: ${t.noteTextColor};
}
.statediagram .edgeLabel {
  color: red; // ${t.noteTextColor};
}

#dependencyStart, #dependencyEnd {
  fill: ${t.lineColor};
  stroke: ${t.lineColor};
  stroke-width: 1;
}

.statediagramTitleText {
  text-anchor: middle;
  font-size: 18px;
  fill: ${t.textColor};
}
`,`getStyles`);export{ze as i,We as n,Xe as r,Ke as t};