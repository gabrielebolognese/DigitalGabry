-- Tags on content items.
--
-- Spec2 1.4's content_items schema has no tags, but 2.3, 4.3 and 5 all put
-- tags in the editor. That is a gap in the specification rather than a choice:
-- the field is asked for three times and given nowhere to live.
--
-- Mirrors block_tags exactly, reusing the same tags table, so a tag means one
-- thing across the app and renaming it does not have to be done twice. Storing
-- them as JSON on the row would have been fewer lines and a second, quietly
-- different, idea of what a tag is.
--
-- Not in the payload, because Spec2 5 item 6 requires YouTubePayload to be an
-- empty type, which leaves nowhere in the payload for a YouTube item's tags.

CREATE TABLE content_tags (
  content_id TEXT NOT NULL REFERENCES content_items(id),
  tag_id     TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (content_id, tag_id)
);

CREATE INDEX idx_content_tags_tag ON content_tags(tag_id);
