# AIR Workbench browser bundle — third-party notices

The checked-in files in `assets/generated/` bundle the following packages.
Versions are frozen by `package-lock.json` (lock SHA-256 at review:
`27630615e3a9fa9c4d11852a3d83bfbd4bf6ed7b21610fe35d42ae61028dcf4a`).
The build-only `esbuild` package is listed as part of the reviewed toolchain.

| Package | Version | License |
| --- | ---: | --- |
| `@xyflow/react` | 12.11.2 | MIT |
| `@xyflow/system` | 0.0.79 | MIT |
| `classcat` | 5.0.5 | MIT |
| `d3-color` | 3.1.0 | ISC |
| `d3-dispatch` | 3.0.1 | ISC |
| `d3-drag` | 3.0.0 | ISC |
| `d3-ease` | 3.0.1 | BSD-3-Clause |
| `d3-interpolate` | 3.0.1 | ISC |
| `d3-selection` | 3.0.0 | ISC |
| `d3-timer` | 3.0.1 | ISC |
| `d3-transition` | 3.0.1 | ISC |
| `d3-zoom` | 3.0.0 | ISC |
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `scheduler` | 0.27.0 | MIT |
| `use-sync-external-store` | 1.6.0 | MIT |
| `zustand` | 4.5.7 | MIT |
| `esbuild` (build only) | 0.28.1 | MIT |

The inventory was generated from the production esbuild metafile and package
metadata after `npm ci --ignore-scripts`. The reviewed `npm audit --json`
snapshot on 2026-07-24 reported zero vulnerabilities at every severity. That
result is time-scoped; the lockfile remains the authoritative dependency tree.

## MIT-licensed packages

Copyright (c) 2019-2025 webkid GmbH (`@xyflow/react`,
`@xyflow/system`)

Copyright © Jorge Bucaran <https://jorgebucaran.com> (`classcat`)

Copyright (c) Meta Platforms, Inc. and affiliates. (`react`, `react-dom`,
`scheduler`, `use-sync-external-store`)

Copyright (c) 2019 Paul Henschel (`zustand`)

Copyright (c) 2020 Evan Wallace (`esbuild`)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## D3 ISC-licensed packages

Copyright 2010-2022 Mike Bostock (`d3-color`)

Copyright 2010-2021 Mike Bostock (`d3-dispatch`, `d3-drag`,
`d3-interpolate`, `d3-selection`, `d3-timer`, `d3-transition`, `d3-zoom`)

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

## d3-ease BSD-3-Clause license

Copyright 2010-2021 Mike Bostock

Copyright 2001 Robert Penner

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
- Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
