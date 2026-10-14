import * as React from "react";
import { toast, Toaster } from "sonner";
import {
  Activity, BarChart3, BookOpen, Download, FileSpreadsheet, FlaskConical, Landmark, Lightbulb, ListChecks,
  Loader2, Moon, Network, ShieldHalf, Sun, Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Alert, Skeleton } from "@/components/ui/misc";
import { DataSourcePanel } from "@/components/panels/DataSourcePanel";
import { LiabilitiesPanel } from "@/components/panels/LiabilitiesPanel";
import { HoldingsPanel, RulesPanel, UniversePanel } from "@/components/panels/RulesPanels";
import { KpiGrid, SummaryHero } from "@/components/tabs/Summary";
import { CoverageChart, OverviewTab } from "@/components/tabs/OverviewTab";
import { BuyListTab } from "@/components/tabs/BuyListTab";
import { CashFlowTab } from "@/components/tabs/CashFlowTab";
import { WhyTab } from "@/components/tabs/WhyTab";
import { RiskTab } from "@/components/tabs/RiskTab";
import { WhatIfTab } from "@/components/tabs/WhatIfTab";
import { StrategiesTab } from "@/components/tabs/StrategiesTab";
import { MarketTab } from "@/components/tabs/MarketTab";
import { MethodTab } from "@/components/tabs/MethodTab";
import { ChartCard } from "@/components/charts";
import { api, type DatasetResponse, type RunBody } from "@/lib/api";
import { date } from "@/lib/format";
import type { DatasetInfo, Filters, Liability, Options, Result, Source } from "@/lib/types";

const DEFAULT_OPTIONS: Options = {
  reinvest_rate: 0, safety_margin: 100, budget: null, max_weight: 100, lot_face: 0, max_volume_pct: 0, tx_cost_bp: 0, holdings: [],
};
const DEFAULT_FILTERS: Filters = {
  include_gsec: true, include_sdl: false, include_tbill: true, min_trades: 0, min_volume: 0, max_stale_days: 99, exclude: [],
};

function useTheme() {
  const [dark, setDark] = React.useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved) return saved === "dark";
    } catch { /* storage blocked */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const [dark, setDark] = useTheme();
  const [mode, setMode] = React.useState<Source>("sample");
  const [dataset, setDataset] = React.useState<DatasetInfo | null>(null);
  const [defaults, setDefaults] = React.useState<Liability[]>([]);
  const [loading, setLoading] = React.useState<Source | null>(null);
  const [liabilities, setLiabilitiesRaw] = React.useState<Liability[]>([]);
  const [touched, setTouched] = React.useState(false);
  const [options, setOptions] = React.useState<Options>(DEFAULT_OPTIONS);
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);
  const [result, setResult] = React.useState<Result | null>(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("overview");
  const reqId = React.useRef(0);

  const setLiabilities = (l: Liability[]) => { setTouched(true); setLiabilitiesRaw(l); };

  const applyDataset = React.useCallback((d: DatasetResponse) => {
    setDataset(d.dataset);
    setDefaults(d.default_liabilities);
    setLiabilitiesRaw((cur) => {
      const settle = d.dataset.settle;
      if (!touched || !cur.length || cur.every((l) => l.date <= settle)) return d.default_liabilities;
      return cur;
    });
    if (d.note) toast.warning(d.note);
    else toast.success(`${d.dataset.usable} usable securities loaded`, { description: d.dataset.label });
  }, [touched]);

  const load = React.useCallback(async (src: Source, fn: () => Promise<DatasetResponse>) => {
    setLoading(src);
    try {
      applyDataset(await fn());
    } catch (e) {
      toast.error(src === "ccil" ? "Could not load CCIL data" : "Could not load data", { description: (e as Error).message });
    } finally {
      setLoading(null);
    }
  }, [applyDataset]);

  // first load: sample data
  React.useEffect(() => { load("sample", api.sample); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const body: RunBody | null = dataset ? { dataset_id: dataset.id, liabilities, options, filters } : null;
  const bodyKey = JSON.stringify(body);

  // re-optimise shortly after any input changes
  React.useEffect(() => {
    if (!body) return;
    if (!liabilities.length) { reqId.current++; setResult(null); setRunning(false); return; }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setRunning(true);
      try {
        const r = await api.optimize(body);
        if (id === reqId.current) { setResult(r); setError(null); }
      } catch (e) {
        if (id === reqId.current) setError((e as Error).message);
      } finally {
        if (id === reqId.current) setRunning(false);
      }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey]);

  const names = React.useMemo(() => Object.fromEntries(
    [...(result?.excluded ?? []), ...(result?.universe ?? [])].map((b) => [b.isin, b.description ?? b.isin])), [result?.universe, result?.excluded]);
  const exclude = (isin: string) => {
    setFilters((f) => ({ ...f, exclude: Array.from(new Set([...f.exclude, isin])) }));
    toast(`Excluded ${names[isin] ?? isin}`, { description: "Re-optimising without it" });
  };
  const download = async (kind: "xlsx" | "buy-order") => {
    if (!body) return;
    const t = toast.loading(kind === "xlsx" ? "Building the committee report…" : "Preparing the buy order…");
    try { await api.download(kind, body); toast.success("Downloaded", { id: t }); }
    catch (e) { toast.error((e as Error).message, { id: t }); }
  };

  const ready = result && result.status !== "infeasible" && result.summary;

  const inputs = (
      <div>
        <DataSourcePanel mode={mode} setMode={setMode} dataset={dataset} loading={loading}
          onSample={() => load("sample", api.sample)}
          onUpload={(f) => load("upload", () => api.upload(f))}
          onCcil={() => load("ccil", api.ccil)} />
        <LiabilitiesPanel liabilities={liabilities} setLiabilities={setLiabilities} settle={dataset?.settle}
          onReset={() => { setTouched(false); setLiabilitiesRaw(defaults); }} />
        <UniversePanel filters={filters} setFilters={setFilters} names={names} eligible={result?.universe?.length} />
        <RulesPanel options={options} setOptions={setOptions} />
        <HoldingsPanel options={options} setOptions={setOptions} names={names} />
        <div className="px-4 py-4 text-[11px] leading-relaxed text-muted-foreground">
          Results update automatically as you change inputs. Amounts in ₹; G-Sec prices from CCIL.
        </div>
      </div>
  );

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden">
        {/* top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur lg:px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sky-300 dark:bg-sky-400/15">
            <Waves className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[14.5px] font-semibold leading-tight tracking-tight">Bond Cash-Flow Matching</div>
            <div className="hidden text-[11.5px] text-muted-foreground sm:block">Network optimisation for G-Sec liability funding</div>
          </div>
          {dataset && (
            <Badge variant={dataset.source === "ccil" ? "good" : "secondary"} className="ml-2 hidden md:inline-flex">
              <Landmark /> {dataset.source === "ccil" ? "CCIL live" : dataset.source === "upload" ? "Uploaded file" : "Sample data"} · prices {date(dataset.last_trade_date)}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            {running && <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Optimising</span>}
            <Button size="sm" variant="outline" disabled={!ready} onClick={() => download("buy-order")} className="hidden sm:inline-flex"><Download /> Buy order</Button>
            <Button size="sm" disabled={!ready} onClick={() => download("xlsx")}><FileSpreadsheet /> Report</Button>
            <Button size="icon" variant="ghost" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun /> : <Moon />}</Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* inputs */}
          <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-r bg-card scroll-thin lg:block">
            {inputs}
          </aside>

          {/* results */}
          <main className="min-w-0 flex-1 overflow-y-auto scroll-thin">
            <div className="mx-auto max-w-[1500px] space-y-4 p-4 lg:p-6">
              <details className="rounded-xl border bg-card lg:hidden">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Inputs</summary>
                {inputs}
              </details>

              {error && <Alert tone="critical" title="The optimiser could not run">{error}</Alert>}
              {dataset && !liabilities.length && <Alert tone="info" title="Add at least one future payment">Use the table, a pattern or a CSV in “Future payments” to see a plan.</Alert>}
              {!result && !error && liabilities.length > 0 && <LoadingState />}

              {result && result.status === "infeasible" && (
                <Alert tone="critical" title="No portfolio can meet these payments">{result.message}</Alert>
              )}
              {result?.warnings?.map((w) => <Alert key={w} tone="warn">{w}</Alert>)}

              {ready && (
                <>
                  <SummaryHero r={result} />
                  <KpiGrid r={result} />
                  <Tabs value={tab} onValueChange={setTab}>
                    <div className="overflow-x-auto scroll-thin pb-1">
                      <TabsList>
                        <TabsTrigger value="overview"><Activity /> Overview</TabsTrigger>
                        <TabsTrigger value="buy"><ListChecks /> Buy list</TabsTrigger>
                        <TabsTrigger value="cash"><Network /> Cash flows</TabsTrigger>
                        <TabsTrigger value="why"><Lightbulb /> Why these bonds</TabsTrigger>
                        <TabsTrigger value="risk"><ShieldHalf /> Rate risk</TabsTrigger>
                        <TabsTrigger value="whatif"><FlaskConical /> What-if</TabsTrigger>
                        <TabsTrigger value="strategies"><BarChart3 /> Strategies</TabsTrigger>
                        <TabsTrigger value="market"><Landmark /> Market data</TabsTrigger>
                        <TabsTrigger value="method"><BookOpen /> Method</TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent value="overview"><OverviewTab r={result} /></TabsContent>
                    <TabsContent value="buy"><BuyListTab r={result} onExclude={exclude} onDownload={download} /></TabsContent>
                    <TabsContent value="cash"><CashFlowTab r={result} /></TabsContent>
                    <TabsContent value="why"><WhyTab r={result} /></TabsContent>
                    <TabsContent value="risk"><RiskTab r={result} /></TabsContent>
                    <TabsContent value="whatif"><WhatIfTab r={result} runCustom={(c) => api.scenario({ ...body!, custom: c })} /></TabsContent>
                    <TabsContent value="strategies"><StrategiesTab r={result} /></TabsContent>
                    <TabsContent value="market"><MarketTab r={result} onExclude={exclude} /></TabsContent>
                    <TabsContent value="method"><MethodTab r={result} /></TabsContent>
                  </Tabs>
                </>
              )}

              {result && result.status === "infeasible" && result.universe?.length > 0 && (
                <MarketTab r={result} onExclude={exclude} />
              )}
              {result?.status === "shortfall" && result.schedule && !ready && (
                <ChartCard title="What can be covered"><CoverageChart r={result} /></ChartCard>
              )}
            </div>
          </main>
        </div>
        <Toaster position="bottom-right" richColors closeButton theme={dark ? "dark" : "light"} />
      </div>
    </TooltipProvider>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}
