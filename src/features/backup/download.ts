/**
 * Hands a text to the browser as a file download. The text never leaves the device: a `Blob` URL
 * is local, and the link is clicked and removed at once.
 */
export function downloadTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Safari starts the download after the click returns: revoking at once can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
