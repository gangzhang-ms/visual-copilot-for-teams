import type {Language} from "../shared/types";
import {LOCAL_CONTEXT_LIMIT} from "../shared/local-context";
export function friendlyLocalError(code:string,language:Language){
  const t=(en:string,zh:string)=>language==="en"?en:zh;
  switch(code){
    case "generation-context-planning":return t("The visual context could not be matched reliably. No images were generated. Edit the description/context or retry explicitly.","未能可靠匹配图片上下文，尚未生成图片。请修改描述或上下文，或手动重试。");
    case "web-image-search-not-configured":return t("Web image search is not configured. AI options will continue.","全网图片搜索尚未配置，AI 方案将继续。");
    case "web-image-search-credential-unavailable":return t("The protected web-search credential cannot be read. AI options will continue.","无法读取受保护的搜索凭据，AI 方案将继续。");
    case "web-image-search-auth":return t("Check the search provider's credential and account access. AI options will continue.","请检查搜索服务的凭据及账户权限，AI 方案将继续。");
    case "web-image-search-query-planning":return t("Safe search keywords could not be prepared. Edit public search terms in More options or retry. AI options continue.","未能准备安全搜索词。可在更多选项中填写公开搜索词或重试，AI 方案继续。");
    case "web-image-search-invalid-query":return t("Edit the short web search terms in More options. AI options can still use your description.","请在更多选项中修改简短搜索词；AI 方案仍可使用主描述。");
    case "web-image-search-rate-limited":return t("Web search is rate limited. Retry search later; AI options continue.","网络搜索暂时限流，请稍后重试搜索；AI 方案继续。");
    case "web-image-search-invalid-response":case "web-image-search-unsafe-result":return t("This search result cannot be used safely. AI options continue.","无法安全使用此搜索结果，AI 方案继续。");
    case "web-image-search-unavailable":case "image-source-unavailable":return t("Image search is unavailable. AI options continue.","图片搜索暂不可用，AI 方案继续。");
    case "generation-source-no-match":return t("No matching image found. AI options will continue.","没有匹配图片，AI 方案将继续。");
    case "generation-source-choice-required":return t("The existing image is unavailable. Choose whether to retry its search or continue with only the AI options.","现成图暂不可用，请选择重试搜索，或仅继续 AI 方案。");
    case "generation-source-disabled":return t("Existing-image search is off.","已关闭现成图搜索。");
    case "local-context-limit":return t(`Select at most ${LOCAL_CONTEXT_LIMIT} context messages. Deselect some messages and retry; your chat and edits are kept.`,`最多选择 ${LOCAL_CONTEXT_LIMIT} 条上下文。请取消部分勾选后重试，聊天和编辑内容仍会保留。`);
    case "busy":case "generation-busy":
      return t("Please wait for the current request to finish, then try again.","请等待当前请求完成，再手动重试。");
    case "generation-cooling-down":case "generation-rate-limited":
      return t("The image service is rate limiting requests. After the wait, try generating again manually.","图像服务暂时限流。请在等待结束后再手动点击生成。");
    case "model-request-envelope-exceeded":case "request-byte-budget-exceeded":case "request-token-budget-exceeded":case "generation-request-too-large":case "generation-invalid-context":
      return t("There is too much content for one request. Shorten the selected context or use a smaller image, then try again. Your conversation is kept.","本次处理的内容过多，请精简选用的上下文或使用更小的图片后重试。聊天内容仍会保留。");
    case "local-message-capacity":return t("This room has reached 40 messages. Remove an unneeded message before adding another.","本房间已有 40 条消息，请删除不需要的消息后再添加。");
    case "local-profile-capacity":return t("This room has 16 speaker profiles. You can still edit an existing profile.","本房间已有 16 份发言者偏好，仍可编辑已有偏好。");
    case "model-output-invalid":case "model-output-invalid-schema":case "model-output-invalid-json":case "model-output-invalid-envelope":
      return t("The explanation could not be completed reliably. Please retry the explanation explicitly.","未能可靠地完成解释，请手动重试解释。");
    case "model-output-invalid-references":
      return t("The explanation refers to content outside your selection. Please retry explicitly.","解释引用了所选内容之外的信息，请手动重试。");
    case "model-output-truncated":return t("The explanation is incomplete. Shorten the optional context and retry.","解释不完整，请精简可选上下文后重试。");
    case "model-refused":case "generation-refused":
      return t("This request could not be fulfilled. Adjust your description before trying again.","无法完成此次请求，请调整描述后再试。");
    case "generation-request-rejected":
      return t("The image service rejected this request. Your description is kept. Adjust it and retry explicitly; if a simple description also fails, contact the app maintainer.","图像服务未接受本次请求，描述仍已保留。可调整后手动重试；若简单描述也失败，请联系应用维护者。");
    case "generation-access-denied":
      return t("The image service denied access. Contact the app maintainer to check credentials and permissions; retrying will not fix access.","图像服务拒绝访问，请联系应用维护者检查凭据和权限；反复重试无法恢复访问。");
    case "generation-billing-unavailable":
      return t("The image service requires an account or billing check by the app maintainer. No automatic retry will occur.","图像服务需要应用维护者检查账户或计费状态，不会自动重试。");
    case "model-provider-auth":case "model-capability-unverified":case "model-contract-rejected":
    case "generation-approval-required":case "generation-approval-expired":case "generation-allowance-unavailable":
    case "validation-only-not-browser-ready":case "image-not-provisioned-or-authorized":case "generation-credential-unavailable":case "generation-capability-unavailable":case "generation-contract-rejected":
      return t("This feature is unavailable. Contact the person who set up this app; retrying alone will not fix it.","此功能暂不可用，请联系应用维护者；仅重试无法解决。");
    case "model-provider-unavailable":case "generation-provider-unavailable":return t("The service is temporarily unavailable. Please try again later.","服务暂不可用，请稍后手动重试。");
    case "model-network-error":return t("The connection was interrupted. Please try again later.","连接中断，请稍后手动重试。");
    case "meme-source-unavailable":return t("Imgflip is unavailable. Retry loading the source or choose another source.","Imgflip 暂不可用，请重新加载或选择其他来源。");
    case "not-configured":
      return t("The service could not be reached. Please try again later.","暂时无法连接服务，请稍后手动重试。");
    case "generation-operation-unresolved":case "generation-unknown-after-dispatch":
      return t("The previous request may still be running. Check its status instead of submitting again.","上次请求可能仍在进行，请查询状态，不要重复提交。");
    case "generation-budget-exhausted":return t("Creation is currently unavailable. You can still view existing images.","暂时无法继续创作，仍可查看已有图片。");
    case "generation-memory-limit":return t("Too many images are being kept for creation. Remove an unneeded generated image or discard an unused result, then try again.","当前保留的创作图片过多，请移除不需要的生成图片或丢弃未使用的结果后再试。");
    case "decoder-budget-exceeded":case "image-budget-exceeded":case "unsupported-format":
      return t("This image cannot be processed. Use a smaller PNG/JPEG or a shorter GIF.","无法处理此图片，请使用更小的 PNG/JPEG 或更短的 GIF。");
    case "local-visual-required":return t("Choose a picture, sticker, GIF or emoji to explain. Plain text can provide context.","请选择图片、贴纸、GIF 或 emoji 进行解释。普通文字可作为上下文。");
    case "generation-invalid-draft":case "processing-review-required":case "generation-stale":case "generation-preview-required":case "generation-review-required":case "generation-operation-not-found":
    case "share-review-required":case "generation-asset-unavailable":
      return t("The content changed or the confirmation expired. Review your current selection again.","内容已更改或确认已过期，请重新确认当前选择。");
    case "timeout":case "generation-timeout":
      return t("This took too long. Check whether the request has finished before trying again.","处理时间过长，请先确认本次请求是否完成，再手动重试。");
    case "cancelled":case "generation-cancelled":return t("Cancelled. Nothing was inserted.","已取消，没有插入内容。");
    case "auth-required":case "expired":return t("This room expired. Refresh the page to reconnect.","本房间已过期，请刷新页面重新连接。");
    case "meme-source-invalid":case "asset-rights-unavailable":
      return t("The selected source is unavailable or has not been approved for use. Choose another source.","所选素材不可用或尚未获得使用许可，请选择其他素材。");
    case "insufficient-candidates":return t("There are not enough suitable images. Try another source or adjust your description.","合适的图片不足，请尝试其他来源或调整描述。");
    case "generation-animation-failed-image-retained":return t("The animation could not be made. Your still image is kept and can still be used.","未能制作动画，静态图片已保留，仍可使用。");
    case "generation-invalid-png":case "generation-invalid-gif":return t("The image could not be completed reliably. Check the result before retrying.","未能可靠地完成图片，请确认结果后再手动重试。");
    case "generation-invalid-response":case "generation-response-too-large":
      return t("The image service returned an unsupported image response. Creation is paused in this room; contact the app maintainer. Your description is kept.","图像服务返回的图片响应不符合要求，本房间已暂停创作。请联系应用维护者，描述仍已保留。");
    case "generation-media-rejected":
      return t("The returned image failed local safety decoding. Creation is paused in this room; contact the app maintainer. Your description is kept.","返回的图片未通过本地安全解码，本房间已暂停创作。请联系应用维护者，描述仍已保留。");
    default:return t("This operation could not be completed. Check its status before trying again; nothing was inserted.","未能完成此次操作，请确认处理状态后再手动重试；没有插入内容。");
  }
}
