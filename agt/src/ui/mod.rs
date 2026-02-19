use colored::Colorize;

pub fn info(msg: &str) {
    eprintln!("{} {}", "[INFO]".blue(), msg);
}

pub fn success(msg: &str) {
    eprintln!("{} {}", "[OK]".green(), msg);
}

pub fn warn(msg: &str) {
    eprintln!("{} {}", "[WARN]".yellow(), msg);
}

pub fn error(msg: &str) {
    eprintln!("{} {}", "[ERROR]".red(), msg);
}
