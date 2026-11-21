//+------------------------------------------------------------------+
//| FXDesk_Strategies.mq5 (v2)                                        |
//| Cluster scalper plus the scanner strategies, for MetaTrader 5.    |
//| Clusters of up to InpClusterMax positions in one direction.       |
//| Each position closes on a small profit; the basket has a stop.    |
//| DEMO ACCOUNTS ONLY unless InpAllowLive is set to true.            |
//+------------------------------------------------------------------+
#property strict
#property description "Cluster scalper with the scanner strategies. Demo first."
#include <Trade/Trade.mqh>

input ENUM_TIMEFRAMES InpEntryTF      = PERIOD_M5;   // entry timeframe: M5, M15 or H1
input bool   InpUseStrategies         = true;        // scanner strategies can start a cluster
input bool   InpTrendPullback         = true;        // trend pullback (passed the scanner's test)
input bool   InpStructure             = false;       // structure retest (not yet passing the test)
input bool   InpEmaCross              = false;       // EMA 9/21 cross (not yet passing the test)
input bool   InpFvg                   = false;       // fair value gap (not yet passing the test)
input bool   InpMicroEntries          = true;        // the EA's own check on every tick, in trend direction
input int    InpMaxSpreadPoints       = 30;          // no new positions when the spread is wider
input int    InpClusterMax            = 10;          // most positions in one cluster
input int    InpOpenGapSec            = 2;           // seconds between two new positions
input double InpTargetMoney           = 0.20;        // close each position at this profit (account currency)
input double InpBasketStopPct         = 10.0;        // close the whole cluster if it loses this % of balance
input double InpDailyCapPct           = 20.0;        // no new clusters after losing this % of the day's balance
input double InpBaseLot               = 0.01;        // lot per position at the starting size
input double InpLotStepBalance        = 5000.0;      // lot grows by one base step for every this much balance
input double InpCatastropheAtr        = 10.0;        // broker stop per position, in ATR (0 = none)
input int    InpCooldownMinutes       = 30;          // pause after a basket stop
input int    InpSessionStart          = 0;           // UTC hour entries may start (0 to 24 = all day)
input int    InpSessionEnd            = 24;          // UTC hour entries stop
input bool   InpAllowLive             = false;       // keep false: demo accounts only
input ulong  InpMagic                 = 20261120;    // identifies this EA's trades
input bool   InpReport                = true;        // send each trade to the FX Desk site
input string InpSiteUrl               = "https://mysignalfrontend.vercel.app";
input string InpMemberKey             = "";          // your signals key (Profile tab, Signals API)

CTrade trade;
int hAtr=INVALID_HANDLE, hE9=INVALID_HANDLE, hE21=INVALID_HANDLE, hE50=INVALID_HANDLE;
int hH50=INVALID_HANDLE, hH200=INVALID_HANDLE, hHAdx=INVALID_HANDLE;
datetime lastBarTime=0;
datetime lastOpenTime=0;
datetime cooldownUntil=0;
int      dayKey=0;
double   dayStartBalance=0;
ulong    closedReported[];

const int    SWING_K = 3;
const int    WINDOW  = 12;
const int    N       = 400;

// forward declarations, so the compiler knows every function before it is called
ENUM_TIMEFRAMES HigherTF();
int  HtfTrend();
bool InSession();
int  OwnPositions(double &floating, int &dir);
double LotForPosition();
bool OpenPosition(int dir, string tag);
void CloseAll(string why);
void ManageCluster();
bool DailyCapHit();
bool Evaluate(int &side, string &name, double &atr);
bool MicroDirection(int &dir);
void TryGrowCluster();
bool PostTrade(string status, ulong ticket, string symbol, string side, double lots, double entry, double sl, double tp, string strategy, double profit);
void ReportOpenById(ulong pid, string side, string name);
bool AlreadyReported(ulong pid);
void ReportClosed();

ENUM_TIMEFRAMES HigherTF()
{
   if(InpEntryTF==PERIOD_M5)  return PERIOD_H1;
   if(InpEntryTF==PERIOD_M15) return PERIOD_H4;
   return PERIOD_D1;
}

int OnInit()
{
   if(!InpAllowLive && AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
   { Print("Not started: not a demo account. Keep InpAllowLive false until demo results are proven."); return INIT_FAILED; }
   if(InpEntryTF!=PERIOD_M5 && InpEntryTF!=PERIOD_M15 && InpEntryTF!=PERIOD_H1)
   { Print("Not started: entry timeframe must be M5, M15 or H1."); return INIT_FAILED; }
   ENUM_TIMEFRAMES h=HigherTF();
   hAtr =iATR(_Symbol,InpEntryTF,14);
   hE9  =iMA(_Symbol,InpEntryTF,9,0,MODE_EMA,PRICE_CLOSE);
   hE21 =iMA(_Symbol,InpEntryTF,21,0,MODE_EMA,PRICE_CLOSE);
   hE50 =iMA(_Symbol,InpEntryTF,50,0,MODE_EMA,PRICE_CLOSE);
   hH50 =iMA(_Symbol,h,50,0,MODE_EMA,PRICE_CLOSE);
   hH200=iMA(_Symbol,h,200,0,MODE_EMA,PRICE_CLOSE);
   hHAdx=iADX(_Symbol,h,14);
   if(hAtr==INVALID_HANDLE||hE9==INVALID_HANDLE||hE21==INVALID_HANDLE||hE50==INVALID_HANDLE||
      hH50==INVALID_HANDLE||hH200==INVALID_HANDLE||hHAdx==INVALID_HANDLE)
   { Print("Not started: an indicator could not be created."); return INIT_FAILED; }
   trade.SetExpertMagicNumber(InpMagic);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hAtr); IndicatorRelease(hE9); IndicatorRelease(hE21); IndicatorRelease(hE50);
   IndicatorRelease(hH50); IndicatorRelease(hH200); IndicatorRelease(hHAdx);
}

//--- +1 up, -1 down, 0 none, from the last CLOSED higher-timeframe candle
int HtfTrend()
{
   double f[1], s[1], adx[1];
   if(CopyBuffer(hH50,0,1,1,f)<1 || CopyBuffer(hH200,0,1,1,s)<1 || CopyBuffer(hHAdx,0,1,1,adx)<1) return 0;
   double c=iClose(_Symbol,HigherTF(),1);
   if(c>s[0] && f[0]>s[0] && adx[0]>=18) return 1;
   if(c<s[0] && f[0]<s[0] && adx[0]>=18) return -1;
   return 0;
}

bool InSession()
{
   MqlDateTime dt; TimeGMT(dt);
   return dt.hour>=InpSessionStart && dt.hour<InpSessionEnd;
}

//--- this EA's positions on this symbol: count, total floating profit, and direction (+1 buy, -1 sell, 0 none)
int OwnPositions(double &floating, int &dir)
{
   int n=0; floating=0; dir=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong tk=PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol || PositionGetInteger(POSITION_MAGIC)!=(long)InpMagic) continue;
      n++;
      floating+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
      dir = PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY ? 1 : -1;
   }
   return n;
}

//--- lot per position: the base lot, stepping up as the balance grows
double LotForPosition()
{
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP), minLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double mult=MathMax(1.0, MathFloor(AccountInfoDouble(ACCOUNT_BALANCE)/InpLotStepBalance));
   double lots=InpBaseLot*mult;
   lots=MathFloor(lots/step)*step;
   if(lots<minLot) lots=minLot;
   if(lots>maxLot) lots=maxLot;
   return lots;
}

bool OpenPosition(int dir, string tag)
{
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK), bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double atr[1];
   if(CopyBuffer(hAtr,0,1,1,atr)<1) return false;
   double lots=LotForPosition();
   double price = dir>0 ? ask : bid;
   double sl = 0;
   if(InpCatastropheAtr>0) sl = dir>0 ? price-InpCatastropheAtr*atr[0] : price+InpCatastropheAtr*atr[0];
   bool ok = dir>0 ? trade.Buy(lots,_Symbol,0,NormalizeDouble(sl,_Digits),0,tag)
                   : trade.Sell(lots,_Symbol,0,NormalizeDouble(sl,_Digits),0,tag);
   if(ok)
   {
      lastOpenTime=TimeCurrent();
      ulong deal=trade.ResultDeal();
      if(deal>0 && HistoryDealSelect(deal))
         ReportOpenById((ulong)HistoryDealGetInteger(deal,DEAL_POSITION_ID), dir>0?"buy":"sell", tag);
   }
   else Print(tag," order failed: ",trade.ResultRetcodeDescription());
   return ok;
}

//--- closes every position of this EA on this symbol
void CloseAll(string why)
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong tk=PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol || PositionGetInteger(POSITION_MAGIC)!=(long)InpMagic) continue;
      trade.PositionClose(tk);
   }
   Print("Cluster closed: ", why);
}

//--- closes single positions that reached the profit target; closes the cluster on basket stop or trend flip
void ManageCluster()
{
   double floating; int dir;
   int n=OwnPositions(floating,dir);
   if(n==0) return;
   double balance=AccountInfoDouble(ACCOUNT_BALANCE);
   if(floating <= -InpBasketStopPct/100.0*balance)
   {
      CloseAll("basket stop");
      cooldownUntil = TimeCurrent() + InpCooldownMinutes*60;
      return;
   }
   int trend=HtfTrend();
   if(trend!=0 && trend!=dir) { CloseAll("trend changed"); return; }
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong tk=PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol || PositionGetInteger(POSITION_MAGIC)!=(long)InpMagic) continue;
      double p=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
      double target=InpTargetMoney*PositionGetDouble(POSITION_VOLUME)/InpBaseLot;   // bigger lot, bigger target
      if(p>=target) trade.PositionClose(tk);
   }
}

//--- today's loss so far, as a percentage of the balance at the start of the day
bool DailyCapHit()
{
   MqlDateTime dt; TimeCurrent(dt);
   int key=dt.year*1000+dt.day_of_year;
   if(key!=dayKey) { dayKey=key; dayStartBalance=AccountInfoDouble(ACCOUNT_BALANCE); }
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   return (equity-dayStartBalance) <= -InpDailyCapPct/100.0*dayStartBalance;
}

//--- the scanner strategies, on the last closed candle. The first one that fires wins.
bool Evaluate(int &side, string &name, double &atr)
{
   MqlRates r[]; ArraySetAsSeries(r,true);
   if(CopyRates(_Symbol,InpEntryTF,0,N,r)<N) return false;
   double a[1]; if(CopyBuffer(hAtr,0,1,1,a)<1) return false; atr=a[0];
   double e50[],e9[],e21[];
   ArraySetAsSeries(e50,true); ArraySetAsSeries(e9,true); ArraySetAsSeries(e21,true);
   if(CopyBuffer(hE50,0,0,N,e50)<N || CopyBuffer(hE9,0,0,N,e9)<N || CopyBuffer(hE21,0,0,N,e21)<N) return false;
   int trend=HtfTrend();
   double o1=r[1].open, c1=r[1].close;
   if(InpTrendPullback)
   {
      double f=e50[1];
      double lo2=MathMin(r[1].low,r[2].low), hi2=MathMax(r[1].high,r[2].high);
      if(trend==1 && lo2<=f+0.25*atr && c1>f && c1>o1) { side=1;  name="Trend pullback"; return true; }
      if(trend==-1 && hi2>=f-0.25*atr && c1<f && c1<o1) { side=-1; name="Trend pullback"; return true; }
   }
   if(InpEmaCross)
   {
      bool up=(e9[1]>e21[1] && e9[2]<=e21[2]), dn=(e9[1]<e21[1] && e9[2]>=e21[2]);
      if(up && trend>=0 && c1>o1) { side=1;  name="EMA cross"; return true; }
      if(dn && trend<=0 && c1<o1) { side=-1; name="EMA cross"; return true; }
   }
   return false;
}

//--- the EA's own check, every tick: trend direction, price on the trend side of EMA 9, spread not too wide
bool MicroDirection(int &dir)
{
   int trend=HtfTrend();
   if(trend==0) return false;
   double e9[1]; if(CopyBuffer(hE9,0,0,1,e9)<1) return false;
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK), bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   if(trend==1 && ask>e9[0]) { dir=1; return true; }
   if(trend==-1 && bid<e9[0]) { dir=-1; return true; }
   return false;
}

//--- adds a position to the cluster when the cluster has room and the direction agrees
void TryGrowCluster()
{
   if(TimeCurrent()<cooldownUntil) return;
   if(!InSession()) return;
   if(DailyCapHit()) return;
   long spread=SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   if(spread>InpMaxSpreadPoints) return;
   double floating; int cdir;
   int n=OwnPositions(floating,cdir);
   if(n>=InpClusterMax) return;
   if(TimeCurrent()-lastOpenTime < InpOpenGapSec) return;

   if(n>0)
   {
      // grow the existing cluster only in its own direction
      int want=0;
      if(MicroDirection(want) && want==cdir) OpenPosition(cdir,"Cluster add");
      return;
   }
   // no cluster yet: a strategy signal or the EA's own check starts one
   int sdir=0; string sname=""; double atr=0;
   if(InpUseStrategies)
   {
      datetime t0=iTime(_Symbol,InpEntryTF,0);
      if(t0!=lastBarTime && Evaluate(sdir,sname,atr)) { OpenPosition(sdir,sname); return; }
   }
   if(InpMicroEntries && MicroDirection(sdir)) OpenPosition(sdir,"Micro");
}

//--- reporting to the site
bool PostTrade(string status, ulong ticket, string symbol, string side, double lots, double entry, double sl, double tp, string strategy, double profit)
{
   if(!InpReport || InpMemberKey=="") return false;
   string now=TimeToString(TimeGMT(),TIME_DATE|TIME_SECONDS);
   StringReplace(now,".","-"); StringReplace(now," ","T"); now+="Z";
   string account=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   string body=StringFormat("{\"account\":\"%s\",\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":\"%s\",\"lots\":%.2f,\"entry\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"strategy\":\"%s\",\"status\":\"%s\",\"profit\":%.2f,\"%s\":\"%s\"}",
                            account,ticket,symbol,side,lots,entry,sl,tp,strategy,status,profit,
                            status=="open"?"opened_at":"closed_at",now);
   uchar data[], result[];
   StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);
   ArrayResize(data,ArraySize(data)-1);
   string headers="Content-Type: application/json\r\nAuthorization: Bearer "+InpMemberKey+"\r\n";
   string result_headers;
   int code=WebRequest("POST",InpSiteUrl+"/api/system?op=mt5-trade",headers,10000,data,result,result_headers);
   if(code==-1){ Print("Report not sent. Add ",InpSiteUrl," in Tools > Options > Expert Advisors."); return false; }
   if(code<200||code>=300){ Print("Report refused by the site (",code,"): ",CharArrayToString(result)); return false; }
   return true;
}

void ReportOpenById(ulong pid, string side, string name)
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong tk=PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol || PositionGetInteger(POSITION_MAGIC)!=(long)InpMagic) continue;
      if((ulong)PositionGetInteger(POSITION_IDENTIFIER)!=pid) continue;   // only the position this order opened
      PostTrade("open",pid,_Symbol,side,PositionGetDouble(POSITION_VOLUME),PositionGetDouble(POSITION_PRICE_OPEN),
                PositionGetDouble(POSITION_SL),PositionGetDouble(POSITION_TP),name,0);
      return;
   }
}

bool AlreadyReported(ulong pid)
{
   for(int i=0;i<ArraySize(closedReported);i++) if(closedReported[i]==pid) return true;
   return false;
}

void ReportClosed()
{
   if(!HistorySelect(TimeCurrent()-7*86400,TimeCurrent())) return;
   for(int i=HistoryDealsTotal()-1;i>=0;i--)
   {
      ulong dt=HistoryDealGetTicket(i);
      if(dt==0) continue;
      if(HistoryDealGetString(dt,DEAL_SYMBOL)!=_Symbol) continue;
      if(HistoryDealGetInteger(dt,DEAL_MAGIC)!=(long)InpMagic) continue;
      if(HistoryDealGetInteger(dt,DEAL_ENTRY)!=DEAL_ENTRY_OUT) continue;
      ulong pid=(ulong)HistoryDealGetInteger(dt,DEAL_POSITION_ID);
      if(AlreadyReported(pid)) continue;
      double profit=HistoryDealGetDouble(dt,DEAL_PROFIT)+HistoryDealGetDouble(dt,DEAL_SWAP)+HistoryDealGetDouble(dt,DEAL_COMMISSION);
      string side=HistoryDealGetInteger(dt,DEAL_TYPE)==DEAL_TYPE_SELL?"buy":"sell";
      if(PostTrade("closed",pid,_Symbol,side,HistoryDealGetDouble(dt,DEAL_VOLUME),HistoryDealGetDouble(dt,DEAL_PRICE),0,0,"",profit))
      { int n=ArraySize(closedReported); ArrayResize(closedReported,n+1); closedReported[n]=pid; }
   }
}

//--- every tick: manage the cluster (targets, basket stop, trend flip), then grow it if allowed
void OnTick()
{
   ManageCluster();
   TryGrowCluster();
   datetime t0=iTime(_Symbol,InpEntryTF,0);
   if(t0!=lastBarTime) { lastBarTime=t0; ReportClosed(); }
}
//+------------------------------------------------------------------+
