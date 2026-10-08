/ q's own view of the blocks q Storyline found, used as the test oracle.
/ Nothing is executed: each block is parsed (parse) and compiled inside a lambda
/ (value "{[] ...}"), which only compiles it.
/
/ input  ($QSTORY_IN, JSON):  [{"id":0,"code":"f:{x+y}","namespace":".ns"}, ...]
/ output ($QSTORY_OUT, JSON): [{"id":0,"parsed":true,"compiled":true,"error":"",
/                               "defs":[".ns.f"],"globals":[...]}, ...]

.qs.qualify:{[ns;n] $[(0=count ns) or "."=first n; n; ns,".",n]}

/ names a parse tree assigns at top level: a:..  a::..  `a set ..  a:..;b:..
.qs.assigned:{[p]
  if[0h<>type p; :()];
  if[0=count p; :()];
  op:first p;
  s:$[10h=type op; op; -10h=type op; enlist op; @[string;op;""]];
  if[s~enlist ";"; :raze .z.s each 1_ p];
  if[(s~enlist ":") or s~"::"; :$[-11h=type p 1; enlist string p 1; ()]];
  if[s~"set"; :$[11h=abs type p 1; string (),p 1; ()]];
  ()}

/ global names a lambda refers to, including those of lambdas nested in it.
/ (value f) is (bytecode; params; locals; (context; globals...); constants...; source)
.qs.globals:{[f]
  v:value f;
  g:string (v 3) except `;
  c:4_ v;
  distinct g,raze .z.s each c where 100h=type each c}

.qs.check:{[b]
  code:b`code; ns:b`namespace;
  r:`id`parsed`compiled`error`defs`globals!(b`id;0b;0b;"";();());
  p:@[{(1b;parse x)};code;{(0b;x)}];
  if[not first p; :r,enlist[`error]!enlist "parse: ",p 1];
  r[`parsed]:1b;
  r[`defs]:.qs.qualify[ns] each .qs.assigned last p;
  f:@[{(1b;value x)};"{[] ",code," }";{(0b;x)}];
  if[not first f; :r,enlist[`error]!enlist "compile: ",f 1];
  if[100h<>type last f; :r,enlist[`error]!enlist "compile: not a lambda"];
  r[`compiled]:1b;
  r[`globals]:.qs.qualify[ns] each .qs.globals last f;
  r}

.qs.in:.j.k raze read0 hsym `$getenv`QSTORY_IN;
(hsym `$getenv`QSTORY_OUT) 0: enlist .j.j .qs.check each .qs.in;
