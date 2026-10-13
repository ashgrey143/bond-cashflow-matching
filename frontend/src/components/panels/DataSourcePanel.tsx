import * as React from "react";
import { Database, ExternalLink, FileUp, Globe, Loader2, PackageOpen, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { date } from "@/lib/format";
import type { DatasetInfo, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Section } from "./common";

const CCIL_URL = "https://www.ccilindia.com/trading-platform";

export function DataSourcePanel({ mode, setMode, dataset, loading, onSample, onUpload, onCcil }: {
  mode: Source; setMode: (m: Source) => void; dataset: DatasetInfo | null; loading: Source | null;
  onSample: () => void; onUpload: (f: File) => void; onCcil: () => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);

  return (
    <Section icon={<Database />} step={1} title="Bond market data"
      subtitle={dataset ? `${dataset.usable} usable securities · ${date(dataset.last_trade_date)}` : "Choose a source"}>
      <Segmented<Source>
        value={mode}
        onChange={setMode}
        options={[
          { value: "sample", label: "Sample", icon: <PackageOpen /> },
          { value: "upload", label: "Upload", icon: <FileUp /> },
          { value: "ccil", label: "CCIL live", icon: <Globe /> },
        ]}
      />

      {mode === "sample" && (
        <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            A CCIL Trading Platform export of G-Sec trades on <b className="text-foreground">19–20 Aug 2026</b> (123 trade rows, 82 securities).
            Good for demos and repeatable results.
          </p>
          <Button size="sm" className="w-full" onClick={onSample} disabled={loading != null}>
            {loading === "sample" ? <Loader2 className="animate-spin" /> : <PackageOpen />} Use sample data
          </Button>
        </div>
      )}

      {mode === "upload" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault(); setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onUpload(f);
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors hover:border-primary/60 hover:bg-primary/5",
            drag && "border-primary bg-primary/5",
          )}
        >
          {loading === "upload" ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <UploadCloud className="h-6 w-6 text-primary" />}
          <div className="text-xs font-medium">Drop a CCIL export or click to browse</div>
          <div className="text-[11px] text-muted-foreground">PDF, Excel, CSV or JSON from the Trading Platform page</div>
          <input ref={fileRef} type="file" hidden accept=".pdf,.xlsx,.xls,.csv,.json"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
        </div>
      )}

      {mode === "ccil" && (
        <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Pulls the latest trading days from CCIL's public Trading Platform table (G-Secs, SDLs and T-Bills, all platforms).
            No sign-in needed. If CCIL can't be reached, the last download is used.
          </p>
          <Button size="sm" className="w-full" onClick={onCcil} disabled={loading != null}>
            {loading === "ccil" ? <Loader2 className="animate-spin" /> : <Globe />} Fetch latest from CCIL
          </Button>
          <a href={CCIL_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-primary hover:underline">
            Open the CCIL Trading Platform <ExternalLink className="h-3 w-3" />
          </a>
          <p className="text-[10.5px] text-muted-foreground/80">CCIL does not authorise commercial use of its website data without written permission.</p>
        </div>
      )}

      {dataset && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border p-3 text-[11.5px]">
          <div className="col-span-2 mb-0.5 flex items-center justify-between">
            <span className="truncate font-medium">{dataset.label}</span>
            <Badge variant={dataset.source === "ccil" ? "good" : "secondary"}>{dataset.source === "ccil" ? "Live" : dataset.source === "upload" ? "File" : "Sample"}</Badge>
          </div>
          <span className="text-muted-foreground">Trade rows</span><span className="text-right tnum">{dataset.rows}</span>
          <span className="text-muted-foreground">Securities</span><span className="text-right tnum">{dataset.securities}</span>
          <span className="text-muted-foreground">Fixed cash flows</span>
          <span className="text-right tnum">{Object.entries(dataset.by_category).map(([k, v]) => `${v} ${k}`).join(" · ")}</span>
          <span className="text-muted-foreground">Trading days</span><span className="text-right">{dataset.trade_dates.map((d) => date(d, false).slice(0, 6)).join(", ")}</span>
          <span className="text-muted-foreground">Settlement (T+1)</span><span className="text-right">{date(dataset.settle)}</span>
        </div>
      )}
    </Section>
  );
}
