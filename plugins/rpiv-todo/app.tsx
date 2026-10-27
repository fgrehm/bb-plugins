import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TodoBanner } from "./src/banner";
import "./app.css";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "rpiv-todo",
    scopes: ["thread", "queued-message"],
    banners: [{ id: "todos", chrome: "card", component: TodoBanner }],
  });
});
