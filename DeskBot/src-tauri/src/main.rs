// Release 下作为 GUI 子系统运行（不弹控制台）；dev 保留控制台看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    deskbot_lib::run();
}
