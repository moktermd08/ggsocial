import Link from "next/link";
import { Badge } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { STATUS_META, inZone, truncate } from "@/lib/format";
import type { PostBundle } from "@/server/queries";

export function PostCard({ post, showBrand = true }: { post: PostBundle; showBrand?: boolean }) {
  const meta = STATUS_META[post.status];
  return (
    <Link
      href={`/posts/${post.id}`}
      className="block rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start gap-3">
        {post.media[0]?.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.media[0].url} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="size-12 shrink-0 rounded-lg" style={{ background: post.brand?.color ?? "#888", opacity: 0.25 }} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {showBrand && post.brand && (
              <Badge color={post.brand.color}>
                <span className="size-1.5 rounded-full" style={{ background: post.brand.color }} />
                {post.brand.name}
              </Badge>
            )}
            <Badge color={meta.color}>{meta.label}</Badge>
          </div>

          <p className="mt-1.5 text-sm font-medium">{post.title || truncate(post.body, 60) || "Untitled"}</p>
          {post.title && post.body && <p className="mt-0.5 text-xs text-muted">{truncate(post.body, 100)}</p>}

          <div className="mt-2 flex items-center gap-2">
            <div className="flex -space-x-1">
              {post.targets.map((t) => (
                <span key={t.id} className="rounded-full ring-2 ring-surface">
                  <PlatformIcon platform={t.channel.platform} size={18} />
                </span>
              ))}
            </div>
            <span className="text-xs text-muted">
              {post.scheduledAt ? inZone(post.scheduledAt, post.brand?.timezone ?? "UTC") : "No date set"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
