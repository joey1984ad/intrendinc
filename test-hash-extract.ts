const extractHash = (creative: any) => {
    if (!creative) return null;
    let hash = creative.image_hash;
    if (!hash && creative.object_story_spec?.link_data?.image_hash) hash = creative.object_story_spec.link_data.image_hash;
    if (!hash && creative.object_story_spec?.video_data?.image_hash) hash = creative.object_story_spec.video_data.image_hash;
    if (!hash && creative.asset_feed_spec?.images?.[0]?.hash) hash = creative.asset_feed_spec.images[0].hash;
    if (!hash && creative.object_story_spec?.link_data?.child_attachments?.[0]?.image_hash) hash = creative.object_story_spec.link_data.child_attachments[0].image_hash;
    return hash;
};
console.log(extractHash({image_hash: "123"}));
