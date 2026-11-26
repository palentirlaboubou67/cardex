# tesseract.js auto-hébergé (lecture du numéro, repli du scanner)

Fichiers copiés tels quels depuis jsDelivr (versions épinglées), chargés à la demande par `js/scan/ocr.js`
(même origine : le service worker les garde en cache, l'OCR marche ensuite hors ligne).

| Fichier | Source | Octets | SHA-256 |
|---|---|---|---|
| `tesseract.esm.min.js` | `tesseract.js@7.0.0/dist/tesseract.esm.min.js` | 63 220 | `64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29` |
| `worker.min.js` | `tesseract.js@7.0.0/dist/worker.min.js` | 111 307 | `576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d` |
| `core/tesseract-core-relaxedsimd-lstm.wasm.js` | `tesseract.js-core@7.0.0` | 3 905 767 | `861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3` |
| `core/tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core@7.0.0` | 3 899 472 | `c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38` |
| `core/tesseract-core-lstm.wasm.js` | `tesseract.js-core@7.0.0` | 3 896 484 | `eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680` |
| `lang/fra.traineddata.gz` | `@tesseract.js-data/fra@1.0.0/4.0.0_best_int` | 707 406 | `d611139672b3752c7097e671e4a1d9209dfd37f2aeb081ef6487fba3351e9255` |

- Le worker choisit lui-même une seule des trois variantes du cœur (relaxed SIMD, SIMD, sinon sans SIMD) :
  un téléphone ne télécharge qu'un fichier de ≈ 3,9 Mo (≈ 1,1 Mo en brotli) plus la langue (0,7 Mo).
- Options utilisées : `workerBlobURL: false` (worker chargé depuis notre origine), `cacheMethod: 'none'`
  (pas de copie IndexedDB, le service worker garde `vendor/**`), `corePath` = dossier `core/`, `langPath` = `lang/`.
- Licences : tesseract.js et tesseract.js-core sous Apache-2.0 (`LICENSE-tesseract.js.md`,
  `LICENSE-tesseract.js-core.txt`) ; données `fra` (tessdata_best de Tesseract, Apache-2.0), paquet npm
  `@tesseract.js-data/fra` sous MIT.
- Mise à jour : retélécharger les mêmes chemins avec la nouvelle version, mettre à jour ce tableau, relancer
  `python -P tools/scan_bench.py ocr`.
