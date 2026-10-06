import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import {AllPackages} from 'mathjax-full/js/input/tex/AllPackages.js';
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', {
  InputJax: new TeX({packages: AllPackages.filter(p => !['require','autoload'].includes(p))}),
  OutputJax: new SVG({fontCache: 'none'}),
});
// returns the LiteElement <svg> for a display-mode TeX string
export function tex2svg(tex) {
  return adaptor.firstChild(doc.convert(tex, {display: true}));
}
