const relayPortInput = document.getElementById('relayPort')
const saveBtn = document.getElementById('saveBtn')
const statusDiv = document.getElementById('status')

// Load saved settings
chrome.storage.local.get(['relayPort'], (result) => {
  if (result.relayPort) {
    relayPortInput.value = result.relayPort
  }
})

// Save settings
saveBtn.addEventListener('click', async () => {
  const raw = relayPortInput.value.trim()

  if (!raw) {
    // Clear port — disable relay
    await chrome.storage.local.remove('relayPort')
    showStatus('Port cleared. Relay disabled.', 'success')
    return
  }

  const port = parseInt(raw, 10)
  if (!port || port < 1 || port > 65535) {
    showStatus('Invalid port number', 'error')
    return
  }

  await chrome.storage.local.set({ relayPort: port })
  showStatus('Settings saved!', 'success')
})

function showStatus(message, type) {
  statusDiv.textContent = message
  statusDiv.className = `status ${type}`
  statusDiv.style.display = 'block'
  setTimeout(() => { statusDiv.style.display = 'none' }, 3000)
}
