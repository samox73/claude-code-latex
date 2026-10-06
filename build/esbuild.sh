#!/bin/sh
# Bundles MathJax into hooks/mathjax/. Split into chunks because the plugin host
# reads no module file over 1 MiB: the font-* entries only exist to force the two
# big font tables (TeX normal, everything else) into chunks of their own.
exec esbuild build/mathjax-entry.js build/font-normal.js build/font-rest.js \
  --bundle --splitting --format=esm --minify --legal-comments=none \
  --define:PACKAGE_VERSION='"3.2.2"' \
  --outdir=hooks/mathjax --entry-names='[name]' --chunk-names='chunk-[hash]'
