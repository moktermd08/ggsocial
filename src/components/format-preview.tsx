"use client";
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Repeat2, Send, ThumbsUp, Bookmark, Share2, Play, Music2 } from "lucide-react";
import { PlatformIcon } from "./platform-icon";
import { FORMAT_META, type ContentFormat } from "@/lib/formats";

/**
 * What a version looks like where it will be posted — close enough to catch a
 * cut-off hook, an over-long caption or a thin carousel before anything goes
 * out. Not a pixel copy of any platform: the proportions, the cut-offs and the
 * order things appear in are the point.
 */

export type PreviewMedia = { url: string; kind: string };

export type PreviewProps = {
  platform: string;
  format: ContentFormat;
  brandName: string;
  handle: string;
  avatarUrl?: string | null;
  brandColor?: string;
  title: string;
  body: string;
  outline: string[];
  script: string;
  media: PreviewMedia[];
  /** Characters this platform allows in the text, when it has a cap. */
  textMax?: number;
};

/** Where each text is cut off before "see more", by platform family. */
const FOLD = { linkedin: 210, facebook: 125, instagram: 125 } as const;

function Rich({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]+|@[\w.]+|https?:\/\/\S+)/gu);
  return (
    <>
      {parts.map((p, i) => /^(#|@|https?:)/.test(p) ? <span key={i} className="text-[#0a66c2] dark:text-[#6cb4ff]">{p}</span> : p)}
    </>
  );
}

function Folded({ text, fold }: { text: string; fold: number }) {
  const [open, setOpen] = useState(false);
  const cut = text.length > fold && !open;
  return (
    <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">
      <Rich text={cut ? text.slice(0, fold).trimEnd() : text} />
      {cut && (
        <>
          … <button type="button" onClick={() => setOpen(true)} className="text-muted hover:underline">see more</button>
        </>
      )}
    </p>
  );
}

function Avatar({ name, url, color, size = 36 }: { name: string; url?: string | null; color?: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: color ?? "#6366f1", fontSize: size * 0.4 }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-xl border border-border bg-white text-[#191919] shadow-sm dark:bg-[#1b1f23] dark:text-[#e8e8e8] ${className}`}>{children}</div>;
}

/** A slide: the picture when there is one, else the slide's own text on the brand colour. */
function Slide({ text, media, color, ratio, index, total }: { text: string; media?: PreviewMedia; color?: string; ratio: string; index: number; total: number }) {
  return (
    <div className="relative grid w-full place-items-center overflow-hidden text-center text-white" style={{ aspectRatio: ratio, background: color ?? "#4f46e5" }}>
      {media?.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
      <p className={`relative z-10 max-w-[85%] whitespace-pre-wrap break-words text-sm font-semibold leading-snug ${media?.kind === "image" ? "rounded bg-black/55 px-2 py-1" : ""}`}>{text || `Slide ${index + 1}`}</p>
      {total > 1 && <span className="absolute right-2 top-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[10px]">{index + 1}/{total}</span>}
    </div>
  );
}

function Slides({ items, media, color, ratio }: { items: string[]; media: PreviewMedia[]; color?: string; ratio: string }) {
  const [i, setI] = useState(0);
  const list = items.length ? items : [""];
  const at = Math.min(i, list.length - 1);
  return (
    <div className="relative">
      <Slide text={list[at]} media={media[at]} color={color} ratio={ratio} index={at} total={list.length} />
      {list.length > 1 && (
        <>
          <button type="button" aria-label="Previous slide" onClick={() => setI(Math.max(0, at - 1))} disabled={at === 0}
            className="absolute left-1.5 top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white disabled:opacity-30"><ChevronLeft className="size-4" /></button>
          <button type="button" aria-label="Next slide" onClick={() => setI(Math.min(list.length - 1, at + 1))} disabled={at === list.length - 1}
            className="absolute right-1.5 top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white disabled:opacity-30"><ChevronRight className="size-4" /></button>
          <div className="absolute inset-x-0 bottom-1.5 z-10 flex justify-center gap-1">
            {list.map((_, d) => <span key={d} className={`size-1.5 rounded-full ${d === at ? "bg-white" : "bg-white/40"}`} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Header({ p, sub }: { p: PreviewProps; sub: string }) {
  return (
    <div className="flex items-center gap-2 p-3 pb-2">
      <Avatar name={p.brandName} url={p.avatarUrl} color={p.brandColor} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[13px] font-semibold">{p.brandName}</p>
        <p className="truncate text-[11px] text-muted">{sub}</p>
      </div>
      <PlatformIcon platform={p.platform} size={18} />
    </div>
  );
}

function VerticalFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="mx-auto w-[210px]">
      <div className="relative overflow-hidden rounded-[22px] border-4 border-[#111] bg-black text-white shadow-md" style={{ aspectRatio: "9/16" }}>
        {children}
      </div>
      <p className="mt-1 text-center text-[10px] text-muted">{label}</p>
    </div>
  );
}

function VideoOverlay({ p, music }: { p: PreviewProps; music?: boolean }) {
  const shot = p.media.find((m) => m.kind === "image");
  const hook = p.script.split(/\n|(?<=[.!?])\s/)[0] || p.outline[0] || p.title;
  return (
    <>
      {shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot.url} alt="" className="absolute inset-0 size-full object-cover opacity-80" />
      ) : <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${p.brandColor ?? "#4f46e5"}, #111)` }} />}
      <div className="absolute inset-x-3 top-[22%] text-center text-[13px] font-bold leading-tight drop-shadow">{hook}</div>
      <Play className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 opacity-70" />
      <div className="absolute right-2 bottom-16 flex flex-col items-center gap-3 text-[10px]">
        <Heart className="size-5" /><MessageCircle className="size-5" /><Send className="size-5" />
      </div>
      <div className="absolute inset-x-3 bottom-3 space-y-1 text-left text-[11px] leading-tight">
        <p className="font-semibold">@{p.handle.replace(/^@/, "")}</p>
        <p className="line-clamp-3 whitespace-pre-wrap break-words">{p.body}</p>
        {music && <p className="flex items-center gap-1 text-[10px] opacity-80"><Music2 className="size-3" /> Original sound</p>}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- families */

function Linkedin(p: PreviewProps) {
  return (
    <Frame>
      <Header p={p} sub="Followers · Just now" />
      <div className="px-3 pb-2"><Folded text={p.body} fold={FOLD.linkedin} /></div>
      {p.format === "carousel" && <Slides items={p.outline} media={p.media} color={p.brandColor} ratio="1/1" />}
      {p.format === "video" && <Slide text={p.title} media={p.media.find((m) => m.kind === "image")} color={p.brandColor} ratio="16/9" index={0} total={1} />}
      {p.format === "post" && p.media[0]?.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.media[0].url} alt="" className="w-full" />
      )}
      <div className="flex justify-around border-t border-border px-2 py-1.5 text-[11px] text-muted">
        <span className="flex items-center gap-1"><ThumbsUp className="size-3.5" /> Like</span>
        <span className="flex items-center gap-1"><MessageCircle className="size-3.5" /> Comment</span>
        <span className="flex items-center gap-1"><Repeat2 className="size-3.5" /> Repost</span>
        <span className="flex items-center gap-1"><Send className="size-3.5" /> Send</span>
      </div>
    </Frame>
  );
}

function Microblog(p: PreviewProps) {
  const posts = p.format === "thread" && p.outline.length ? p.outline : [p.body];
  const max = p.textMax ?? 280;
  return (
    <Frame>
      {posts.map((t, i) => (
        <div key={i} className="relative flex gap-2 p-3 pb-2">
          {i < posts.length - 1 && <span className="absolute bottom-0 left-[27px] top-12 w-0.5 bg-border" />}
          <Avatar name={p.brandName} url={p.avatarUrl} color={p.brandColor} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] leading-tight"><b>{p.brandName}</b> <span className="text-muted">@{p.handle.replace(/^@/, "")} · now</span></p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug"><Rich text={t} /></p>
            {i === 0 && p.media[0]?.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.media[0].url} alt="" className="mt-2 max-h-56 w-full rounded-xl border border-border object-cover" />
            )}
            <p className={`mt-1 text-[10px] ${t.length > max ? "font-semibold text-danger" : "text-muted"}`}>{t.length}/{max}{posts.length > 1 ? ` · ${i + 1} of ${posts.length}` : ""}</p>
          </div>
        </div>
      ))}
    </Frame>
  );
}

function Facebook(p: PreviewProps) {
  return (
    <Frame>
      <Header p={p} sub="Just now · Public" />
      <div className="px-3 pb-2"><Folded text={p.body} fold={FOLD.facebook * 2} /></div>
      {p.format === "carousel" && <Slides items={p.outline} media={p.media} color={p.brandColor} ratio="1/1" />}
      {p.format === "post" && p.media[0]?.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.media[0].url} alt="" className="w-full" />
      )}
      <div className="flex justify-around border-t border-border px-2 py-1.5 text-[11px] text-muted">
        <span className="flex items-center gap-1"><ThumbsUp className="size-3.5" /> Like</span>
        <span className="flex items-center gap-1"><MessageCircle className="size-3.5" /> Comment</span>
        <span className="flex items-center gap-1"><Share2 className="size-3.5" /> Share</span>
      </div>
    </Frame>
  );
}

function Instagram(p: PreviewProps) {
  if (p.format === "reel") return <VerticalFrame label="Reel · 9:16"><VideoOverlay p={p} music /></VerticalFrame>;
  if (p.format === "story") {
    const frames = p.outline.length ? p.outline : [p.title || p.body];
    return (
      <VerticalFrame label={`Story · ${frames.length} frame${frames.length === 1 ? "" : "s"}`}>
        <div className="absolute inset-x-2 top-2 z-10 flex gap-1">{frames.map((_, i) => <span key={i} className={`h-0.5 flex-1 rounded ${i === 0 ? "bg-white" : "bg-white/40"}`} />)}</div>
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm font-semibold" style={{ background: `linear-gradient(160deg, ${p.brandColor ?? "#4f46e5"}, #111)` }}>{frames[0]}</div>
      </VerticalFrame>
    );
  }
  return (
    <Frame>
      <Header p={p} sub="Sponsored · Just now" />
      {p.format === "carousel"
        ? <Slides items={p.outline} media={p.media} color={p.brandColor} ratio="4/5" />
        : p.media[0]?.kind === "image"
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.media[0].url} alt="" className="w-full" />
          : <Slide text={p.title || p.body.slice(0, 80)} color={p.brandColor} ratio="4/5" index={0} total={1} />}
      <div className="flex gap-3 px-3 pt-2 text-muted"><Heart className="size-5" /><MessageCircle className="size-5" /><Send className="size-5" /><Bookmark className="ml-auto size-5" /></div>
      <div className="px-3 pb-3 pt-1 text-[13px] leading-snug"><b>{p.handle.replace(/^@/, "")}</b> <Folded text={p.body} fold={FOLD.instagram} /></div>
    </Frame>
  );
}

function Youtube(p: PreviewProps) {
  if (p.format === "short") return <VerticalFrame label="Short · 9:16"><VideoOverlay p={p} /></VerticalFrame>;
  return (
    <Frame>
      <div className="relative">
        <Slide text={p.title} media={p.media.find((m) => m.kind === "image")} color="#111" ratio="16/9" index={0} total={1} />
        <Play className="absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-1/2 text-white/80" />
      </div>
      <div className="space-y-1 p-3">
        <p className="text-[13px] font-semibold leading-snug">{p.title}{p.title.length > 70 ? "" : ""}</p>
        <p className="text-[11px] text-muted">{p.brandName} · 0 views · just now</p>
        <p className="line-clamp-3 whitespace-pre-wrap text-[12px] leading-snug text-muted">{p.body}</p>
        {p.outline.length > 0 && (
          <ol className="mt-1 space-y-0.5 text-[11px]">
            {p.outline.map((c, i) => <li key={i}><span className="text-[#065fd4]">{String(Math.floor((i * 90) / 60)).padStart(1, "0")}:{String((i * 90) % 60).padStart(2, "0")}</span> {c}</li>)}
          </ol>
        )}
      </div>
    </Frame>
  );
}

function Tiktok(p: PreviewProps) {
  return <VerticalFrame label="TikTok · 9:16"><VideoOverlay p={p} music /></VerticalFrame>;
}

function Document({ p, email }: { p: PreviewProps; email: boolean }) {
  return (
    <Frame>
      {email ? (
        <div className="border-b border-border bg-surface-2 p-3 text-[12px] dark:text-[#e8e8e8]">
          <p className="text-muted">From <b className="text-inherit">{p.brandName}</b></p>
          <p className="mt-0.5 text-[13px] font-semibold">{p.title || "(no subject)"}</p>
          {p.outline[0] && <p className="text-[11px] text-muted">{p.outline[0]}</p>}
        </div>
      ) : (
        <div className="p-4 pb-0"><h3 className="text-lg font-bold leading-tight">{p.title || "Untitled"}</h3><p className="mt-1 text-[11px] text-muted">{p.brandName} · 5 min read</p></div>
      )}
      <div className="space-y-2 p-4 text-[13px] leading-relaxed">
        <p className="whitespace-pre-wrap break-words">{p.body}</p>
        {p.outline.slice(email ? 1 : 0).map((s, i) => <p key={i} className="font-semibold">{s}</p>)}
      </div>
    </Frame>
  );
}

function Generic(p: PreviewProps) {
  return (
    <Frame>
      <Header p={p} sub="Just now" />
      <div className="px-3 pb-3"><p className="whitespace-pre-wrap break-words text-[13px] leading-snug"><Rich text={p.body} /></p></div>
      {p.format === "carousel" && <Slides items={p.outline} media={p.media} color={p.brandColor} ratio="1/1" />}
    </Frame>
  );
}

export function previewFamily(platform: string, format: ContentFormat) {
  if (format === "article" || format === "newsletter") return format === "newsletter" ? "email" : "document";
  if (platform === "linkedin") return "linkedin";
  if (["x", "threads", "bluesky", "mastodon"].includes(platform)) return "microblog";
  if (platform === "facebook") return "facebook";
  if (platform === "instagram") return "instagram";
  if (platform === "youtube") return "youtube";
  if (platform === "tiktok") return "tiktok";
  return "generic";
}

export function FormatPreview(p: PreviewProps) {
  const family = previewFamily(p.platform, p.format);
  return (
    <div className="space-y-1">
      {family === "linkedin" && <Linkedin {...p} />}
      {family === "microblog" && <Microblog {...p} />}
      {family === "facebook" && <Facebook {...p} />}
      {family === "instagram" && <Instagram {...p} />}
      {family === "youtube" && <Youtube {...p} />}
      {family === "tiktok" && <Tiktok {...p} />}
      {family === "email" && <Document p={p} email />}
      {family === "document" && <Document p={p} email={false} />}
      {family === "generic" && <Generic {...p} />}
      {p.textMax && p.body.length > p.textMax && family !== "microblog" && (
        <p className="text-[11px] font-medium text-danger">{p.body.length}/{p.textMax} characters — over this platform&apos;s limit.</p>
      )}
      <p className="text-[10px] text-muted">{FORMAT_META[p.format].label} as it will look on this channel. A guide, not a pixel copy.</p>
    </div>
  );
}
