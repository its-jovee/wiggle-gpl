# TikTok safe-area guidance

Checked: 2026-07-26

## Product conclusion

Wigo's TikTok overlay is a **UI visibility guide**, not a crop preview.

Wigo exports the complete 9:16 frame. TikTok's feed chrome can cover parts of
its presentation: feed tabs and search at the top, engagement actions on the
right, and username/caption/sound information near the bottom. The bottom app
navigation is app chrome, not evidence that those rows of pixels were removed
from the encoded video. Wigo therefore does not draw it as a crop boundary.

The lower keep-clear band remains useful for important text because captions
and sound attribution can obscure it. Artwork may extend through every shaded
area; only essential text, logos, faces, and calls to action should stay inside
the dashed UI-safe guide.

For Wigo's organic-feed preview, the working 1080×1920 guide is 130 px from
the top, 340 px from the bottom, 60 px from the left, and 140 px from the right.
This is a deliberately rounded compromise across current organic UI references,
which commonly report about 108–140 px top, 320–367 px bottom, and 120–164 px
right clearance. The engagement rail is bottom-weighted (profile at 970 px,
share at 1650 px) and the caption stack starts below the guide rather than being
vertically centered in the frame.

## Evidence and limits

- [TikTok Auction In-Feed Ads](https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads?lang=en-GB)
  recommends vertical 9:16 video and says the safe zone changes with the video
  dimensions, caption length, and additional formats. It also warns that the
  preview and live result can differ because the preview is not device-specific.
- [TikTok Reservation In-Feed Ads](https://ads.tiktok.com/help/article/tiktok-reservation-in-feed-ads-reach-frequency?lang=en)
  says key elements outside its safe zone may be *covered or cropped* and
  recommends checking the actual result in TikTok's preview tool. This wording
  does not establish every unsafe band as a crop.
- TikTok's downloadable In-Feed Standard LTR template is an **advertising**
  template. It includes caption/CTA allowances and is more restrictive than a
  stable organic-post crop specification. Wigo therefore uses it as evidence
  for the kinds of UI obstruction to expect, not as a pixel-exact organic-feed
  mask.
- Current organic-feed cross-checks: [PostPlanify](https://postplanify.com/tools/tiktok-safe-zone-checker)
  reports 108 px top / 320 px bottom / 60 px left / 120 px right, while
  [Asobi Tools](https://asobi.tools/safe-zone-checker/) reports 131 px top /
  367 px bottom / 120 px sides. These are observational references rather than
  TikTok guarantees.

There is no single device-independent organic TikTok safe rectangle. Wigo's
1080×1920 measurements are intentionally conservative approximations and must
be revisited when TikTok materially changes its feed UI.
