import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {LocalChatApp} from "./LocalChatApp";
it("renders an English initial shell without requiring a language change",()=>{
  const html=renderToStaticMarkup(<LocalChatApp/>);
  expect(html).toContain("Opening your local session");
  expect(html).toContain('<option value="en" selected="">English</option>');
  expect(html).not.toContain("正在打开本地会话");
});
