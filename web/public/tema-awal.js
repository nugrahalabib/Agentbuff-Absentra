// Pasang tema sebelum halaman tergambar (lihat src/lib/tema.ts). Berkas terpisah
// supaya tetap jalan di bawah Content-Security-Policy tanpa 'unsafe-inline'.
;(function () {
  var p = 'sistem'
  try {
    p = localStorage.getItem('absentra_tema') || ''
    if (!p) {
      var lama = JSON.parse(localStorage.getItem('absentra_ui_v1') || 'null')
      var t = lama && lama.state && lama.state.theme
      p = t === 'dark' ? 'gelap' : t === 'light' ? 'terang' : 'sistem'
    }
  } catch (e) {
    p = 'sistem'
  }
  var gelap = p === 'gelap'
  if (p === 'sistem') {
    try {
      gelap = window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch (e) {
      gelap = false
    }
  }
  document.documentElement.setAttribute('data-theme', gelap ? 'dark' : 'light')
})()
