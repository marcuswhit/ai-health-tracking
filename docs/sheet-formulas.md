# Sheet formulas

For repairing the sheet, or rebuilding it without the template. Columns are described in [data-dictionary.md](data-dictionary.md).

Row 2 of each tab; fill down (Daily row 3 onward: `A3 = A2+1`; Weekly row 3 onward: `A3 = A2+7`). `LOG(col)` below is shorthand for:
`=IF(COUNTIFS(Log!$A:$A,">="&$A2,Log!$A:$A,"<"&$A2+1)=0,"",SUMIFS(Log!$<col>:$<col>,Log!$A:$A,">="&$A2,Log!$A:$A,"<"&$A2+1))`

**Daily**
- A2 `=Targets!$B$9`
- B2 `=IFERROR(INDEX(wearable_daily!$A:$Z,MATCH($A2,wearable_daily!$B:$B,0),MATCH("active_calories",wearable_daily!$1:$1,0)),"")`
- C2 `=ROUND(Targets!$B$2+Targets!$B$3*N(B2)+IF($Z2="Yes",Targets!$B$16*4,0),-1)`
- D2 LOG(D); E2 `=IF(D2="","",C2-D2)`; F2 LOG(E); G2 `=IF(F2="","",Targets!$B$4-F2)`; H2 LOG(F); I2 LOG(G); J2 LOG(H)
- L2 / M2 / Q2 / X2: as B2 but reading "sleep_score", "readiness_score", "activity_score" and "total_calories"
- N2 as LOG(D) but with `">="&($A2+TIME(17,0,0))` as the lower bound
- P2 as LOG(I) with an extra condition `,Log!$B:$B,"<>Ride fuel"`
- R2 LOG(K); S2 LOG(L); T2 LOG(M)
- U2 `=IFERROR(INDEX(FILTER(INDEX(wearable_sleep!$A:$Z,0,MATCH("bedtime_start",wearable_sleep!$1:$1,0)),wearable_sleep!$B:$B=$A2+1,INDEX(wearable_sleep!$A:$Z,0,MATCH("type",wearable_sleep!$1:$1,0))="main"),1),"")`; V2 and W2 the same with "early_wake_min" and "early_wake_count"
- Z2 `=IF($A2="","",IF($Y2<>"",$Y2,IF(TEXT($A2+1,"ddd")=Targets!$B$17,"Yes","No")))`
- AA2 `=IF($A2="","",ROUND(Targets!$B$14+Targets!$B$15*N($B2)/100+IF($Z2="Yes",Targets!$B$16,0),-1))`
- AB2 `=IF(H2="","",AA2-H2)`
- AC2 `=IF(H2="","",ROUND(H2/IF(COUNT($K$2:$K2)=0,Targets!$B$7,LOOKUP(9.99E+307,$K$2:$K2)),1))`

**Weekly** (headers: Week starting, Days logged, Avg calories eaten, Avg calorie target, Avg protein, Avg fibre, Exercise calories, Weigh-ins, Avg weight, Change from start, Left to goal, Avg calories from 5pm, Avg added sugar, Avg saturated fat, Alcohol week)
- A2 `=Targets!$B$9`; B2 `=COUNTIFS(Daily!$A:$A,">="&$A2,Daily!$A:$A,"<"&$A2+7,Daily!$D:$D,">0")`
- C2, D2, E2, F2, L2, M2, N2: `=IF($B2=0,"",AVERAGEIFS(Daily!$<col>:$<col>,Daily!$A:$A,">="&$A2,Daily!$A:$A,"<"&$A2+7,Daily!$D:$D,">0"))` for Daily D, C, F, J, N, P, R
- G2 `=SUMIFS(Daily!$B:$B,Daily!$A:$A,">="&$A2,Daily!$A:$A,"<"&$A2+7)`
- H2 `=COUNTIFS(Daily!$A:$A,">="&$A2,Daily!$A:$A,"<"&$A2+7,Daily!$K:$K,">0")`; I2 `=IF($H2=0,"",AVERAGEIFS(Daily!$K:$K,Daily!$A:$A,">="&$A2,Daily!$A:$A,"<"&$A2+7,Daily!$K:$K,">0"))`
- J2 `=IF($I2="","",$I2-Targets!$B$7)`; K2 `=IF($I2="","",$I2-Targets!$B$8)`
- O2 `=IF($B2=0,"",SUMIFS(Daily!$S:$S,Daily!$A:$A,">="&$A2,Daily!$A:$A,"<"&$A2+7))`

Number formats: counts and grams `#,##0;(#,##0);"-"`; alcohol `0.0;(0.0);"-"`; weights `0.0`; dates `ddd d mmm yyyy`; Log A `ddd d mmm yyyy, h:mm am/pm`; Daily U `h:mm am/pm`.

Tabs: `Log` (13 columns, headers as in the data dictionary), `Daily`, `Weekly`, `Suggestions` (11 columns, A as date-time), `Targets` (rows 2-18 as in the data dictionary). Add three tabs, `wearable_daily`, `wearable_sleep` and `wearable_workouts`, with the header rows in [wearable-layer.md](wearable-layer.md); the sync fills them. The `oura_*` raw tabs are created by `apps-script/Oura_sync.gs` on its first run. The optional `strava_activities` and `gym_sets` tabs (and their logs) are created by `Strava_sync.gs` and `FitNotes_import.gs` the first time they run.
