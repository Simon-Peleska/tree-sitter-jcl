import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.antlr.v4.runtime.BaseErrorListener;
import org.antlr.v4.runtime.CharStreams;
import org.antlr.v4.runtime.CommonTokenStream;
import org.antlr.v4.runtime.RecognitionException;
import org.antlr.v4.runtime.Recognizer;

// Parses each file listed in args[0] with mapa's ANTLR JCL grammar and prints
// "path<TAB>ok|error<TAB>first error" per file.
public class Verdicts {
  public static void main(String[] args) throws Exception {
    for (String path : Files.readAllLines(Path.of(args[0]))) {
      if (path.isBlank()) continue;
      List<String> errors = new ArrayList<>();
      BaseErrorListener collect = new BaseErrorListener() {
        @Override
        public void syntaxError(Recognizer<?, ?> r, Object symbol, int line, int col, String msg, RecognitionException e) {
          errors.add(line + ":" + col + " " + msg.replaceAll("[\\t\\n\\r]", " "));
        }
      };
      JCLLexer lexer = new JCLLexer(CharStreams.fromPath(Path.of(path)));
      lexer.removeErrorListeners();
      lexer.addErrorListener(collect);
      JCLParser parser = new JCLParser(new CommonTokenStream(lexer));
      parser.removeErrorListeners();
      parser.addErrorListener(collect);
      parser.startRule();
      System.out.println(path + "\t" + (errors.isEmpty() ? "ok" : "error") + "\t" + (errors.isEmpty() ? "" : errors.get(0)));
    }
  }
}
