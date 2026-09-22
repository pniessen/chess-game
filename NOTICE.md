# Third-party assets

Chess piece artwork: the **Rhosgfx** set by RhosGFX, released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
(public domain dedication). Obtained from the Lichess asset repository,
which records the licence in its `COPYING.md`.
Source: https://rhosgfx.itch.io/vector-chess-pieces

CC0 requires no attribution; this credit is given voluntarily.

Chess piece artwork (second set): the **Cburnett** set by Colin M.L. Burnett,
12 SVGs (king/queen/rook/bishop/knight/pawn x light/dark), vendored
unmodified in `public/pieces/cburnett/`. Each file's Commons page states:
"I, the copyright holder of this work, hereby publish it under the
following licenses" and offers, as alternatives: the GNU Free Documentation
License (v1.2 or later); Creative Commons Attribution-ShareAlike 3.0
Unported; the GNU General Public License; and the BSD license (2-clause,
"Copyright (c) The author. Redistribution and use in source and binary
forms, with or without modification, are permitted provided that the
following conditions are met: 1. Redistributions of source code must
retain the above copyright notice, this list of conditions and the
following disclaimer. 2. Redistributions in binary form must reproduce the
above copyright notice, this list of conditions and the following
disclaimer in the documentation and/or other materials provided with the
distribution. 3. Neither the name of The author nor the names of its
contributors may be used to endorse or promote products derived from this
software without specific prior written permission. THIS SOFTWARE IS
PROVIDED BY THE AUTHOR AND CONTRIBUTORS \"AS IS\" AND ANY EXPRESS OR
IMPLIED WARRANTIES ... ARE DISCLAIMED."). We redistribute under this BSD
license, as authorized by the Task 15 controller ruling (P1).

Author: Colin M.L. Burnett ([User:Cburnett on Wikimedia
Commons](https://commons.wikimedia.org/wiki/User:Cburnett)). Each SVG is
credited on Commons as the author's "own work", dated 27 December 2006.

Sources (Commons file pages, license verified on each on 2026-09-21, files
fetched from the linked `upload.wikimedia.org` original):
- King:   https://commons.wikimedia.org/wiki/File:Chess_klt45.svg (white),
  https://commons.wikimedia.org/wiki/File:Chess_kdt45.svg (black)
- Queen:  https://commons.wikimedia.org/wiki/File:Chess_qlt45.svg (white),
  https://commons.wikimedia.org/wiki/File:Chess_qdt45.svg (black)
- Rook:   https://commons.wikimedia.org/wiki/File:Chess_rlt45.svg (white),
  https://commons.wikimedia.org/wiki/File:Chess_rdt45.svg (black)
- Bishop: https://commons.wikimedia.org/wiki/File:Chess_blt45.svg (white),
  https://commons.wikimedia.org/wiki/File:Chess_bdt45.svg (black)
- Knight: https://commons.wikimedia.org/wiki/File:Chess_nlt45.svg (white),
  https://commons.wikimedia.org/wiki/File:Chess_ndt45.svg (black)
- Pawn:   https://commons.wikimedia.org/wiki/File:Chess_plt45.svg (white),
  https://commons.wikimedia.org/wiki/File:Chess_pdt45.svg (black)

Under the BSD license above: Copyright (c) Colin M.L. Burnett. Redistributed
under the BSD license terms quoted above; this attribution is given to meet
that license's attribution requirement.

Opening names and lines: the **lichess-org/chess-openings** dataset
(`a.tsv`–`e.tsv`, vendored unmodified in `data/openings/`), released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
Source: https://github.com/lichess-org/chess-openings at commit
`c67912be581f0793dbaa776be5ccf111e01f88d9`.
`public/openings/openings.json` is generated from it by `npm run openings`.

CC0 requires no attribution; this credit is given voluntarily.

Typefaces: **Figtree** by the Figtree Project Authors, and **Bricolage
Grotesque** by the Bricolage Grotesque Project Authors, both released under
the [SIL Open Font License, Version 1.1](https://scripts.sil.org/OFL).
Variable woff2 files (latin subset) are vendored unmodified in
`public/fonts/` as `figtree-latin-var.woff2` and
`bricolage-grotesque-latin-var.woff2`, fetched from the Google Fonts CDN
(`fonts.googleapis.com` / `fonts.gstatic.com`) on 2026-09-21 and self-hosted
so the app makes no font requests over the network. Each font's licence
text, with its copyright line, is vendored unmodified from the
`google/fonts` GitHub repository as `public/fonts/OFL-Figtree.txt` and
`public/fonts/OFL-BricolageGrotesque.txt`.
Sources: https://github.com/google/fonts/blob/main/ofl/figtree/OFL.txt and
https://github.com/google/fonts/blob/main/ofl/bricolagegrotesque/OFL.txt

The OFL permits this redistribution and requires the licence to accompany
the fonts, which the vendored `OFL-*.txt` files satisfy.

Tactics puzzles: a curated subset of about 3,000 puzzles from the **Lichess
puzzle database**, released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
Source: https://database.lichess.org/#puzzles (`lichess_db_puzzle.csv.zst`,
downloaded 2026-09-21). `data/puzzles/puzzles.csv` keeps the columns
PuzzleId, FEN, Moves, Rating and Themes of the selected rows, unmodified; it
was selected by `scripts/curate-puzzles.ts` (quality filter, rating buckets,
theme diversity). `public/puzzles/puzzles.json` is generated from it by
`npm run puzzles`.

CC0 requires no attribution; this credit is given voluntarily.
