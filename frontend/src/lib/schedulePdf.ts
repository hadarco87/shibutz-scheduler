import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

export async function elementToPdfBlob(el: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0.5) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  return pdf.output("blob");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function sharePdfViaWhatsApp(
  blob: Blob,
  filename: string,
  message: string
): Promise<"shared" | "fallback"> {
  const file = new File([blob], filename, { type: "application/pdf" });
  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({
        files: [file],
        title: "שיבוץ",
        text: message,
      });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return "shared";
      }
      /* fall through */
    }
  }

  downloadBlob(blob, filename);
  const text = encodeURIComponent(
    `${message}\n\nהקובץ PDF הורד למכשיר — צרפו אותו לצ׳אט בוואטסאפ.`
  );
  window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  return "fallback";
}

export function schedulePdfFilename(companyName: string, windowStart: string) {
  const d = new Date(windowStart);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const safe = (companyName || "pluga").replace(/[^\w\u0590-\u05FF\-]+/g, "_");
  return `shibutz-${safe}-${stamp}.pdf`;
}
