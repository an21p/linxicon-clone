/ Real-time database: subscribes to a tickerplant, keeps today's trades
/ and quotes in memory, and writes them to the HDB at end of day.

/ ---------------------------------------------------------------
/ utilities
/ ---------------------------------------------------------------

log:{[lvl;msg] -1 string[.z.p]," ",string[lvl]," ",msg;}

/ retry a function up to n times, waiting ms between tries
retry:{[n;ms;f;arg]
  r:@[f;arg;{(`err;x)}];
  if[(`err~first r) and n>1; system"sleep ",string ms%1000; :.z.s[n-1;ms;f;arg]];
  r }

\d .cfg
tpPort:5010
hdbDir:`:/data/hdb
eodHour:23
\d .

/ schemas
trade:([] time:`timespan$(); sym:`symbol$(); price:`float$(); size:`long$())
quote:([] time:`timespan$(); sym:`symbol$(); bid:`float$(); ask:`float$())

writeTable:{[dir;d;t]
  log[`info;"writing ",string t];
  .Q.dpft[dir;d;`sym;t];
  @[`.;t;0#] }

endOfDay:{[d]
  log[`info;"end of day ",string d];
  writeTable[.cfg.hdbDir;d] each tables`.;
  .Q.gc[] }

upd:{[t;x] t insert x }

.u.end:{[d] endOfDay d }

connect:{[port]
  h:retry[5;2000;hopen;port];
  if[`err~first h; log[`error;"cannot reach tickerplant"]; exit 1];
  h }

replay:{[h]
  r:h"(.u.sub[`;`];`.u `i`L)";
  (.[;();:;].) each r 0;
  -11!r 1 }

stats:{select n:count i, vwap:size wavg price by sym from trade}

\p 5011
h:connect .cfg.tpPort
replay h
log[`info;"rdb ready"]
