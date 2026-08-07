# Security policy

## Reporting a vulnerability

Report it privately through GitHub. Go to the **Security** tab of
https://github.com/keivanmalhani/lutbox and choose **Report a vulnerability**
to open a private advisory. That goes to the maintainer and stays private until
there is a fix.

Please do not open a public issue for a vulnerability.

Include what you did, what happened, and what you expected. Whatever reproduces
it, an input file, a command line, a link, helps more than a description of it.

## Scope

In scope is anything that gets a visitor's image or LUT off their machine, or
that makes the page do something they did not ask for. That includes:

- any network request at all carrying image data, LUT data, or anything derived
  from either. The page is supposed to make none after it loads
- a crafted `.cube` file that leads to script execution, unbounded memory use,
  or a hang the page never recovers from
- a crafted image file that does the same
- anything in the build or release pipeline that could put code the maintainer
  did not write onto the published site

Out of scope: missing hardening headers with no demonstrated impact, output
from an automated scanner with no working proof, and the general observation
that a page can read a file the visitor deliberately handed it.

## What this app is

A static site with no server behind it and no network access after load. It is
one HTML file, one stylesheet, one JavaScript bundle and one preview image, all
served from GitHub Pages.

Your image and your LUT are read with the browser's File API, decoded in the
tab, and applied on your own graphics card or, where WebGL2 is missing, on your
own processor. Nothing is uploaded, because there is nowhere to upload to.
There is no `fetch`, no `XMLHttpRequest` and no form post anywhere in the
project.

It uses no browser storage of any kind. Nothing persists between visits.

If you can demonstrate a single outbound request carrying any part of a file
the visitor opened, that is the most serious report this project can receive
and it should be sent privately.

## Supported versions

The most recent tagged release is the supported version. Fixes are made there
and deployed to https://keivanmalhani.github.io/lutbox/. Older tags do not get
backported fixes.
