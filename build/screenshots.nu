#!/usr/bin/env nu
# Take the README screenshots: a real `claude` in a real kitty on a headless
# sway, driven through kitty's remote control and captured with grim. It uses
# your Claude Code login and sends one real prompt per screenshot.
#
#   nix shell nixpkgs#sway -c nu build/screenshots.nu
#
# Writes assets/screenshot-after.png (this mod loaded) and
# assets/screenshot-before.png (the same prompt without it), each cropped to
# the prompt and the reply.

const repo = path self ..

const PROMPT = 'Show off my math rendering with a short physics example: the Fröhlich Hamiltonian as a bare align* environment, the second-order electron-phonon self-energy with an \underbrace labelling the coupling, the Pauli matrices with pmatrix, and \boxed{E = \hbar\omega} as the final result. One short sentence of prose before each, nothing else.'

# One output, 960x1200 logical at scale 2: tall enough that the reply never scrolls.
const SWAY = 'output HEADLESS-1 resolution 1920x2400 scale 2 bg #1e1e1e solid_color
default_border none
gaps inner 0
xwayland disable'

const KITTY = 'font_family JetBrains Mono
font_size 11.5
disable_ligatures always
cursor_blink_interval 0
window_padding_width 6
allow_remote_control yes
enable_audio_bell no
confirm_os_window_close 0
background #1e1e1e
foreground #d4d4d4'

const PAD = 12 # window_padding_width 6 at scale 2, in physical pixels

def bg [cmd: string, log: string]: nothing -> int {
    ^bash -c $"($cmd) > '($log)' 2>&1 & echo $!" | into int
}

def stop [pid: int] {
    ^bash -c $"kill ($pid) 2>/dev/null; while kill -0 ($pid) 2>/dev/null; do sleep 0.1; done"
}

def until [what: string, check: closure, --timeout: duration = 30sec] {
    let deadline = (date now) + $timeout
    while not (do $check) {
        if (date now) > $deadline { error make {msg: $"timed out waiting for ($what)"} }
        sleep 200ms
    }
}

def --wrapped rc [sock: string, ...args: string] { ^kitty @ --to $sock ...$args }
def screen [sock: string]: nothing -> string { rc $sock get-text | complete | get stdout }

# Send the prompt, wait for the reply to finish, capture, and crop to the
# prompt line through the reply's end.
def drive [run: string, sock: string, out: string] {
    until "kitty" { (rc $sock ls | complete).exit_code == 0 }
    # a fresh folder asks for trust first; its default is "No, exit"
    until "claude to start" { (screen $sock) =~ 'trust this folder|for shortcuts|shift\+tab to cycle' } --timeout 60sec
    if ((screen $sock) =~ 'trust this folder') { rc $sock send-key down; rc $sock send-key enter; sleep 2sec }
    until "the prompt box" { (screen $sock) =~ 'for shortcuts|shift\+tab to cycle' } --timeout 60sec
    $PROMPT | rc $sock send-text --stdin
    rc $sock send-key enter
    # done once the spinner's "esc to interrupt" is gone and the screen sits still
    until "the reply to start" { (screen $sock) =~ 'esc to interrupt' } --timeout 60sec
    mut calm = 0
    mut last = ""
    while $calm < 15 {
        let s = screen $sock
        $calm = if $s == $last and not ($s =~ 'esc to interrupt') { $calm + 1 } else { 0 }
        $last = $s
        sleep 200ms
    }
    sleep 2sec # let kitty paint the last images
    let full = $run | path join full.png
    with-env {XDG_RUNTIME_DIR: $run, WAYLAND_DISPLAY: wayland-1} { ^grim -o HEADLESS-1 $full }

    # crop rows: from the prompt's first line to the last non-empty line before
    # the input box; images show as blank lines in the text
    let lines = screen $sock | lines
    let first = $lines | enumerate | where {|l| $l.item | str contains 'Show off my math' } | first | get index
    let box = $lines | enumerate | where {|l| $l.index > $first and $l.item =~ '^[─━]{10}' } | first | get index
    let last = $lines | enumerate | where {|l| $l.index > $first and $l.index < $box and ($l.item | str trim) != '' } | last | get index
    let win = rc $sock ls | from json | get 0.tabs.0.windows.0
    let size = ^magick identify -format '%w %h' $full | split row ' ' | into int
    let cell = ($size.1 - 2 * $PAD) / $win.lines
    let top = $PAD + ($first - 1) * $cell | math floor
    let height = ($last - $first + 3) * $cell | math ceil
    ^magick $full -crop $"($size.0)x($height)+0+($top)" +repage $out
}

# One screenshot with claude started under `settings`.
def shot [name: string, settings: record] {
    let run = mktemp -d
    $SWAY | save ($run | path join sway.conf)
    $KITTY | save ($run | path join kitty.conf)
    let work = $run | path join demo # a fresh, short project path
    mkdir $work
    let sway = with-env {XDG_RUNTIME_DIR: $run, WLR_BACKENDS: headless, WLR_RENDERER: pixman, WLR_LIBINPUT_NO_DEVICES: "1"} {
        hide-env -i WAYLAND_DISPLAY DISPLAY SWAYSOCK
        bg $"sway -c '($run)/sway.conf'" ($run | path join sway.log)
    }
    let sock = $"unix:($run)/kitty.sock"
    let out = $repo | path join assets $"screenshot-($name).png"
    try {
        until "sway" { $run | path join wayland-1 | path exists }
        let kitty = with-env {XDG_RUNTIME_DIR: $run, WAYLAND_DISPLAY: wayland-1} {
            hide-env -i DISPLAY
            bg $"kitty --config '($run)/kitty.conf' --listen-on ($sock) --directory '($work)' claude --settings '($settings | to json -r)'" ($run | path join kitty.log)
        }
        try { drive $run $sock $out; print $"assets/screenshot-($name).png" } catch {|e| print -e $"($name) failed: ($e.msg)\nlogs in ($run)\nscreen:\n(screen $sock)" }
        stop $kitty
    } catch {|e|
        print -e $"($name) failed: ($e.msg)\nlogs in ($run)"
    }
    stop $sway
}

def main [] {
    hide-env -i DISPLAY WAYLAND_DISPLAY WAYLAND_SOCKET SWAYSOCK
    # run from inside a Claude Code session, its session markers would leak in
    for v in ($env | columns | where {|c| $c =~ '^CLAUDE' and $c != CLAUDE_CONFIG_DIR }) { hide-env $v }
    # only this mod: any other enabled plugin would add its own lines to the reply
    let others = open ($env.CLAUDE_CONFIG_DIR? | default ($env.HOME | path join .claude) | path join settings.json)
        | get -o enabledPlugins | default {} | columns | each {|p| {$p: false} } | reduce -f {} {|it, acc| $acc | merge $it }
    shot after {enabledPlugins: $others, env: {CLAUDE_CODE_PLUGIN_DIRS: $repo}}
    shot before {enabledPlugins: $others, env: {CLAUDE_CODE_PLUGIN_DIRS: ""}}
}
