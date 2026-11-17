// Receives { html, text } from the service worker and puts both on the clipboard.
// navigator.clipboard needs a focused document, which an offscreen document never is,
// so this uses execCommand('copy') and fills the clipboard in the copy event.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.type !== 'copy') return false;
  sendResponse(copy(message.text, message.html));
  return false;
});

function copy(text, html) {
  const onCopy = (event) => {
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
    if (html) event.clipboardData.setData('text/html', html);
  };
  const buffer = document.getElementById('buffer');
  buffer.value = text;
  buffer.select();
  document.addEventListener('copy', onCopy);
  try {
    return document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy);
    buffer.value = '';
  }
}
