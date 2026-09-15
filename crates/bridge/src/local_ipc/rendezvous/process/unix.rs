use std::{
    io,
    os::unix::process::CommandExt,
    process::{Child, Command, Stdio},
    sync::mpsc::{SendError, sync_channel},
    thread,
};

use super::CoreProcessSpec;

pub(super) fn spawn(spec: &CoreProcessSpec) -> io::Result<()> {
    let mut command = Command::new(spec.executable());
    command
        .args(spec.arguments())
        .current_dir(spec.working_directory()?)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);

    spawn_with_reaper(&mut command)
}

fn spawn_with_reaper(command: &mut Command) -> io::Result<()> {
    let (send_child, receive_child) = sync_channel::<Child>(1);
    let _reaper = thread::Builder::new()
        .name("mcpatch-core-reaper".into())
        .spawn(move || {
            if let Ok(mut child) = receive_child.recv() {
                let _ = child.wait();
            }
        })?;

    let child = command.spawn()?;
    send_child.send(child).map_err(|SendError(mut child)| {
        let _ = child.kill();
        let _ = child.wait();
        io::Error::other("bridge core reaper stopped unexpectedly")
    })
}
