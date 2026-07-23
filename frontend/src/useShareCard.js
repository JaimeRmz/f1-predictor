import { useRef, useState, useCallback } from "react";
import { toPng } from "html-to-image";

// Shared capture-and-share logic for the off-screen 1200×630 share cards
// (solo prediction card + Me-vs-Model comparison card), so the toPng call, the
// flag-decode await, and the share/download fallback live in one place.
//
// Returns:
//   cardRef     attach to the off-screen card node
//   shareState  "idle" | "working" (drive a pending button state)
//   share()     capture the node → native share sheet (mobile) or file download
export function useShareCard(fileName, shareText = "F1 Race Predictor.") {
  const cardRef = useRef(null);
  const [shareState, setShareState] = useState("idle");

  const share = useCallback(async () => {
    if (!cardRef.current || shareState === "working") return;
    setShareState("working");
    try {
      // html-to-image captures whatever is rendered right now, so a flag <img>
      // that hasn't finished loading would come out blank — wait for it to decode.
      await Promise.all(
        [...cardRef.current.querySelectorAll("img")].map(img =>
          img.complete && img.naturalWidth ? null : img.decode().catch(() => {})
        )
      );
      // skipFonts: the site's web fonts are already loaded in the document, and
      // inlining the cross-origin Google Fonts stylesheet throws a SecurityError
      // that stalls the capture — the fonts still render from the page.
      const dataUrl = await toPng(cardRef.current, {
        width: 1200, height: 630, pixelRatio: 1, cacheBust: true, skipFonts: true,
      });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName, { type: "image/png" });

      // Native share sheet (mobile) when it can take the file; otherwise download.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "F1 Race Predictor", text: shareText });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      // User dismissing the share sheet throws AbortError — not a real failure.
      if (err?.name !== "AbortError") console.error("Share failed:", err);
    } finally {
      setShareState("idle");
    }
  }, [fileName, shareText, shareState]);

  return { cardRef, shareState, share };
}
