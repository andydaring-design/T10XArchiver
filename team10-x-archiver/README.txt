Team 10 X Archiver v1.1.0 - install / update
1. Unzip this folder and copy your "icons" folder into it (icons are not included here).
2. chrome://extensions -> enable Developer mode -> Load unpacked -> select the folder
   (or click the reload icon on the existing extension). Chrome asks to approve the "debugger"
   permission - it is used only for the one-page PDF of the original X page.
3. Log in to X in this browser (X only shows replies to logged-in users). Set X's display language to English
   (Settings > Accessibility, display and languages > Languages) - the "Show more replies" buttons are found by their wording.
4. Open an X post, click the extension icon, enter your name, choose the maximum number of replies and the export
   options, press "Start Capturing Post/Replies".
5. The X tab comes to the front while the replies are loaded: the page scrolls by itself and presses the
   "Show more replies" / "Show probable spam" buttons. Leave it alone until the results tab comes back.
   If the post is not open in the current tab, it is opened in a new tab and closed again afterwards.
   It first reads how many replies X reports for the post: with none it skips the reply search, otherwise it stops as
   soon as that many have been found.
   If fewer are found on the post's page than X reports, the results tab asks whether to search replies to replies
   (X only shows those on each reply's own page). Yes = the X tab opens each reply that has replies of its own, in turn,
   until the reported number is reached - this can take a few minutes; the review page then shows those replies
   indented under the reply they answer. Anything X hides (deleted posts, protected / suspended / blocked accounts,
   filtered replies) cannot be found either way.
   The results tab shows a [Stop loading replies] button while this runs: it stops and keeps everything collected so far.
   Loading also stops by itself after 30 minutes, or if nothing new appears for 25 scroll steps.
6. On the results tab:
   - Tick the replies of interest and give a reason.
   - Highlight text in the post, a quoted post or ANY reply and press "Add Information Entry With Quote"
     (the button also pops up right next to your highlight). Type the information, tick "Also flag this
     reply" if you want, and press Add. The quote, its source (who / when / link) and your information
     go into the Assessment. Highlighted text stays yellow - click it to jump to its entry; "Show in page" jumps back.
   - Plain information items can still be typed into the Information box, one per line.
   - Untick an image box to leave that image out of the DOCX / TXT / clipboard / working document.
   - Fill in Notes and Next Action(s), then Export - or use the Download / "DOCX to Clipboard" buttons.

What is captured
- The post (text, links, photos, video / GIF thumbnails, any quoted post, engagement counts at the time of capture),
  every reply X shows, and - if the post is itself a reply - the earlier posts above it in the thread.
- Promoted posts (ads) and the "Discover more" section below the conversation are skipped.
- Replies found on the post's page are listed in X's order; replies to replies found by the deeper search are indented under
  the reply they answer. Where X shows "Replying to @...", that is recorded.
- Replies that X shortens with "Show more" are marked; the reply URL leads to the full text.
- Most X videos are streamed in pieces and cannot be saved from here: the thumbnail is archived (GIFs and
  plain video files get a Download Video button).
- If X says "Something went wrong" (usually a rate limit), the capture waits and retries by itself.

PDF options
- "PDF (original page)": X only draws the posts near the screen, so the page is photographed one screen at a time
  and the screens are stacked into one long PDF page, with ads, sign-up bars, the sidebar and the navigation menu
  (which shows your own X account) removed. Very long threads are scaled down (to no less than 35%) and, if still
  too tall, split into a few very long pages. Chrome shows a "started debugging this browser" bar while it runs.
- "PDF (full thread)": the post and EVERY captured reply as shown on the review page, with your flags,
  highlights and Assessment. Choose "Single long page" or "A4 pages" in the popup. In Chrome's print dialog
  pick "Save as PDF" and leave Margins on "Default".

Working documents
- In the popup, enter your name, then use [New Doc] (document number + case initials) or [Load Doc].
  Documents are called "D### XX Media Search - X" and are stored inside Chrome (browser storage for this
  extension), not as visible files. Clearing the extension's site data or removing the extension deletes them.
  They are separate from the Reddit Archiver's and News Article Extractor's working documents.
- On the results page, [Add to Working Document] stores the post, its flagged replies, ticked images,
  information entries and your Assessment. Adding the same post again offers to update it.
- "Show/Hide document content summary & Document Options" -> [Create Final DOCX] lets you group every
  information point by subject, pick the suggested actions, and builds the combined document.

Manage Docs (popup)
- [Manage Docs] lists every stored working document. Tick one or more, then:
  Delete (asks first) | Export (saves a .T10x file to your Downloads folder) | Import (reads a .T10x file).
- A .T10x file carries a checksum, so a damaged or hand-edited file is rejected on import. Files made by older or
  newer versions of the extension import fine: missing sections are filled in, unknown sections are ignored.
- Importing a document whose name already exists asks before replacing it.
- Import opens in its own small window, because Chrome closes a toolbar popup as soon as a file dialog opens.
  Click Import there again and choose the file; the imported document becomes the working document.
