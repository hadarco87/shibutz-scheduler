import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

function stampDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function safeCompany(companyName: string) {
  return (companyName || "pluga").replace(/[^\w\u0590-\u05FF\-]+/g, "_");
}

type Capture = {
  imgData: string;
  imgWidth: number;
  imgHeight: number;
  pageHeight: number;
};

async function captureElementPng(el: HTMLElement): Promise<Capture> {
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  });
  const pdfProbe = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdfProbe.internal.pageSize.getWidth();
  const pageHeight = pdfProbe.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  return {
    imgData: canvas.toDataURL("image/png"),
    imgWidth,
    imgHeight,
    pageHeight,
  };
}

function appendElementCaptureToPdf(
  pdf: jsPDF,
  capture: Capture,
  isFirstInDocument: boolean
) {
  let heightLeft = capture.imgHeight;
  let position = 0;

  if (!isFirstInDocument) {
    pdf.addPage();
  }

  pdf.addImage(
    capture.imgData,
    "PNG",
    0,
    position,
    capture.imgWidth,
    capture.imgHeight
  );
  heightLeft -= capture.pageHeight;

  while (heightLeft > 0.5) {
    position = heightLeft - capture.imgHeight;
    pdf.addPage();
    pdf.addImage(
      capture.imgData,
      "PNG",
      0,
      position,
      capture.imgWidth,
      capture.imgHeight
    );
    heightLeft -= capture.pageHeight;
  }
}

export async function elementToPdfBlob(el: HTMLElement): Promise<Blob> {
  const capture = await captureElementPng(el);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  appendElementCaptureToPdf(pdf, capture, true);
  return pdf.output("blob");
}

/** One PDF: each element becomes a contiguous section (extra pages as needed). */
export async function elementsToCombinedPdfBlob(
  els: HTMLElement[]
): Promise<Blob> {
  if (!els.length) throw new Error("אין תוכן ל־PDF");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  for (let i = 0; i < els.length; i++) {
    const capture = await captureElementPng(els[i]);
    appendElementCaptureToPdf(pdf, capture, i === 0);
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
  const stamp = stampDate(new Date(windowStart));
  return `shibutz-${safeCompany(companyName)}-${stamp}.pdf`;
}

export function schedulePlanPdfFilename(
  companyName: string,
  startIso: string,
  endIso: string
) {
  const a = stampDate(new Date(startIso));
  const b = stampDate(new Date(endIso));
  return `shibutz-${safeCompany(companyName)}-${a}_to_${b}.pdf`;
}
