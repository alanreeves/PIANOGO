export async function renderPdfPages(file, { scale = 2.0, maxPages = 1 } = {}) {
  if (!window.pdfjsLib) throw new Error("PDF renderer library is not loaded.");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";

  const bytes = await file.arrayBuffer();
  const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
  const pdfDoc = await loadingTask.promise;
  const pageCount = Math.min(pdfDoc.numPages, maxPages);
  const pages = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({
      pageNumber: pageNum,
      totalPages: pdfDoc.numPages,
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      width: canvas.width,
      height: canvas.height,
    });
  }

  return pages;
}
