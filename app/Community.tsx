import { useState, type FormEvent } from "react";
import {
  Search,
  Download,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Users,
} from "lucide-react";
import type { Body } from "../server/types.ts";
async function request(url: string, post = false) {
  const r = await fetch(
    url,
    post
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }
      : {},
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Community request failed.");
  return d;
}
export default function Community({
  onAdopt,
}: {
  onAdopt: (body?: Body) => void;
}) {
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState("nyan-cat");
  const [collection, setCollection] = useState("cats");
  const [result, setResult] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [collectionView, setCollectionView] = useState<any>(null);
  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const search = (page = 1) =>
    act("search", async () => {
      setCollectionView(null);
      setResult(
        await request(
          `/api/community?q=${encodeURIComponent(query)}&page=${page}`,
        ),
      );
    });
  const show = (id: string) =>
    act("preview", async () =>
      setPreview(
        await request(`/api/community/${encodeURIComponent(id)}/preview`),
      ),
    );
  const adopt = (id: string) =>
    act(id, async () => {
      const b = await request(
        `/api/community/${encodeURIComponent(id)}/adopt`,
        true,
      );
      setNotice(
        `${b.name} is home. Choose its model and tools in the creator.`,
      );
      setPreview((p: any) => (p?.id === id ? { ...p, installed: true } : p));
      setResult((r: any) =>
        r
          ? {
              ...r,
              pets: r.pets.map((p: any) =>
                p.id === id ? { ...p, installed: true } : p,
              ),
            }
          : r,
      );
      onAdopt(b);
    });
  return (
    <details className="community-panel">
      <summary>
        <Users size={17} />
        <span>Adopt from the community</span>
        <small>codex-pets.net</small>
      </summary>
      <div className="community-content">
        <p>
          A familiar face from another creator. Adoption installs only the body.
        </p>
        <div className="community-controls">
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void search();
            }}
          >
            <label htmlFor="community-search">Discover companions</label>
            <div className="inline-input">
              <input
                id="community-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cats, robots, foxes…"
              />
              <button className="secondary" disabled={!!busy}>
                <Search size={15} /> Search
              </button>
            </div>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void show(slug.trim());
            }}
          >
            <label htmlFor="community-slug">Or enter a pet slug</label>
            <div className="inline-input">
              <input
                id="community-slug"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <button className="secondary" disabled={!!busy}>
                Preview
              </button>
            </div>
          </form>
        </div>
        <form
          className="collection-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act("collection", async () => {
              setCollectionView(
                await request(
                  `/api/community/collections/${encodeURIComponent(collection)}`,
                ),
              );
              setResult(null);
            });
          }}
        >
          <label htmlFor="collection-slug">Collection</label>
          <input
            id="collection-slug"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            required
          />
          <button className="text-button" disabled={!!busy}>
            Preview collection <ChevronRight size={14} />
          </button>
        </form>
        {busy && (
          <p role="status" className="footnote">
            {busy === "search"
              ? "Finding companions…"
              : busy === "preview"
                ? "Opening their profile…"
                : "Working on your adoption…"}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="community-notice" role="status">
            {notice}
          </p>
        )}
        {preview && (
          <div className="community-preview">
            <img src={preview.poster} alt={preview.name} />
            <div>
              <span className="eyebrow">MEET YOUR NEXT COMPANION</span>
              <h3>{preview.name}</h3>
              <p>{preview.description}</p>
              <a
                className="attribution"
                href={preview.url}
                target="_blank"
                rel="noreferrer"
              >
                Created by @{preview.creator} <ArrowUpRight size={12} />
              </a>
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  disabled={!!busy || preview.installed}
                  onClick={() => void adopt(preview.id)}
                >
                  <Download size={15} />
                  {preview.installed ? "Already at home" : "Adopt this body"}
                </button>
              </div>
              <small>
                Artwork attribution is retained. A runnable agent sheet is
                created separately.
              </small>
            </div>
          </div>
        )}
        {collectionView && (
          <div className="collection-heading">
            <div>
              <h3>{collectionView.name}</h3>
              <p>{collectionView.pets.length} community bodies</p>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                void act("collection-adopt", async () => {
                  const d = await request(
                    `/api/community/collections/${encodeURIComponent(collectionView.slug)}/adopt`,
                    true,
                  );
                  const ok = d.results.filter((r: any) => r.ok);
                  setNotice(
                    `Adopted ${ok.length} bodies. ${d.results.length - ok.length} were preserved or need attention.`,
                  );
                  setError(
                    d.results
                      .filter((r: any) => !r.ok)
                      .map((r: any) => `${r.id}: ${r.error}`)
                      .join("\n"),
                  );
                  onAdopt();
                })
              }
            >
              <Download size={15} /> Adopt collection
            </button>
          </div>
        )}
        {(result || collectionView) && (
          <div className="community-grid">
            {(result?.pets || collectionView?.pets || []).map((p: any) => (
              <button
                type="button"
                key={p.id}
                onClick={() => void show(p.id)}
                className="community-card"
              >
                <img src={p.poster} alt="" loading="lazy" />
                <strong>{p.name}</strong>
                <small>@{p.creator}</small>
                {p.installed && <span>At home</span>}
              </button>
            ))}
          </div>
        )}
        {result && (
          <div className="community-pagination">
            <span>
              {result.total} companions · page {result.page} of{" "}
              {result.totalPages}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Previous community page"
              disabled={!!busy || result.page <= 1}
              onClick={() => void search(result.page - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Next community page"
              disabled={!!busy || result.page >= result.totalPages}
              onClick={() => void search(result.page + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
